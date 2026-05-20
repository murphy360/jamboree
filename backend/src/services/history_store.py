from __future__ import annotations

import sqlite3
from pathlib import Path
from threading import Lock

from src.services.models import TileLocation


class TileHistoryStore:
    def __init__(self, db_path: str = "/app/data/tile_history.db", max_points_per_tile: int = 100) -> None:
        self._db_path = Path(db_path)
        self._max_points_per_tile = max_points_per_tile
        self._lock = Lock()
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._connection = sqlite3.connect(self._db_path, check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self) -> None:
        with self._lock:
            self._connection.execute(
                """
                CREATE TABLE IF NOT EXISTS tile_history (
                    tile_uuid TEXT NOT NULL,
                    label TEXT NOT NULL,
                    latitude REAL NOT NULL,
                    longitude REAL NOT NULL,
                    observed_at TEXT NOT NULL,
                    tile_service_observed_at TEXT,
                    polled_at TEXT,
                    observed_at_second TEXT NOT NULL,
                    PRIMARY KEY (tile_uuid, observed_at_second)
                )
                """
            )
            self._ensure_columns()
            self._connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_tile_history_tile_observed
                ON tile_history (tile_uuid, observed_at DESC)
                """
            )
            self._connection.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS idx_tile_history_tile_second
                ON tile_history (tile_uuid, observed_at_second)
                """
            )
            self._connection.commit()

    def _ensure_columns(self) -> None:
        columns = {
            row["name"]
            for row in self._connection.execute("PRAGMA table_info(tile_history)").fetchall()
        }

        missing_columns = {
            "label": "ALTER TABLE tile_history ADD COLUMN label TEXT NOT NULL DEFAULT ''",
            "tile_service_observed_at": "ALTER TABLE tile_history ADD COLUMN tile_service_observed_at TEXT",
            "polled_at": "ALTER TABLE tile_history ADD COLUMN polled_at TEXT",
            "observed_at_second": "ALTER TABLE tile_history ADD COLUMN observed_at_second TEXT",
        }

        for column_name, statement in missing_columns.items():
            if column_name not in columns:
                self._connection.execute(statement)

        if "observed_at_second" not in columns:
            self._connection.execute(
                """
                UPDATE tile_history
                SET observed_at_second = CASE
                    WHEN instr(observed_at, '.') > 0 THEN substr(observed_at, 1, instr(observed_at, '.') - 1)
                    ELSE observed_at
                END
                WHERE observed_at_second IS NULL OR observed_at_second = ''
                """
            )

    def record(self, locations: list[TileLocation]) -> None:
        with self._lock:
            self._record_locked(locations)

    def _record_locked(self, locations: list[TileLocation]) -> None:
        touched_tiles: set[str] = set()

        for location in locations:
            touched_tiles.add(location.tile_uuid)
            observed_at_second = location.observed_at.replace(microsecond=0).isoformat()

            if self._should_compact_latest_run(location):
                self._connection.execute(
                    """
                    UPDATE tile_history
                    SET label = ?,
                        latitude = ?,
                        longitude = ?,
                        observed_at = ?,
                        tile_service_observed_at = ?,
                        polled_at = ?,
                        observed_at_second = ?
                    WHERE rowid = (
                        SELECT rowid
                        FROM tile_history
                        WHERE tile_uuid = ?
                        ORDER BY observed_at DESC, rowid DESC
                        LIMIT 1
                    )
                    """,
                    (
                        location.label,
                        location.latitude,
                        location.longitude,
                        location.observed_at.isoformat(),
                        location.tile_service_observed_at.isoformat() if location.tile_service_observed_at else None,
                        location.polled_at.isoformat() if location.polled_at else None,
                        observed_at_second,
                        location.tile_uuid,
                    ),
                )
                continue

            # De-duplicate per tile by second while still allowing updates within that second.
            self._connection.execute(
                """
                INSERT INTO tile_history (
                    tile_uuid,
                    label,
                    latitude,
                    longitude,
                    observed_at,
                    tile_service_observed_at,
                    polled_at,
                    observed_at_second
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(tile_uuid, observed_at_second)
                DO UPDATE SET
                    label = excluded.label,
                    latitude = excluded.latitude,
                    longitude = excluded.longitude,
                    observed_at = excluded.observed_at,
                    tile_service_observed_at = excluded.tile_service_observed_at,
                    polled_at = excluded.polled_at
                """,
                (
                    location.tile_uuid,
                    location.label,
                    location.latitude,
                    location.longitude,
                    location.observed_at.isoformat(),
                    location.tile_service_observed_at.isoformat() if location.tile_service_observed_at else None,
                    location.polled_at.isoformat() if location.polled_at else None,
                    observed_at_second,
                ),
            )

        for tile_uuid in touched_tiles:
            self._connection.execute(
                """
                DELETE FROM tile_history
                WHERE tile_uuid = ?
                  AND rowid NOT IN (
                      SELECT rowid
                      FROM tile_history
                      WHERE tile_uuid = ?
                      ORDER BY observed_at DESC
                      LIMIT ?
                  )
                """,
                (tile_uuid, tile_uuid, self._max_points_per_tile),
            )

        if touched_tiles:
            self._connection.commit()

    def _should_compact_latest_run(self, location: TileLocation) -> bool:
        rows = self._connection.execute(
            """
            SELECT latitude, longitude
            FROM tile_history
            WHERE tile_uuid = ?
            ORDER BY observed_at DESC, rowid DESC
            LIMIT 2
            """,
            (location.tile_uuid,),
        ).fetchall()

        if len(rows) < 2:
            return False

        newest, previous = rows
        return (
            newest["latitude"] == location.latitude
            and newest["longitude"] == location.longitude
            and previous["latitude"] == location.latitude
            and previous["longitude"] == location.longitude
        )

    def get_history(self, tile_uuid: str) -> list[TileLocation]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT tile_uuid, latitude, longitude, observed_at, label, tile_service_observed_at, polled_at
                FROM tile_history
                WHERE tile_uuid = ?
                ORDER BY observed_at ASC
                """,
                (tile_uuid,),
            ).fetchall()
        return [TileLocation.model_validate(dict(row)) for row in rows]

    def get_latest_locations(self) -> list[TileLocation]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT h.tile_uuid, h.latitude, h.longitude, h.observed_at, h.label, h.tile_service_observed_at, h.polled_at
                FROM tile_history h
                WHERE h.rowid = (
                    SELECT x.rowid
                    FROM tile_history x
                    WHERE x.tile_uuid = h.tile_uuid
                    ORDER BY COALESCE(x.polled_at, x.observed_at) DESC, x.observed_at DESC, x.rowid DESC
                    LIMIT 1
                )
                ORDER BY h.label ASC
                """
            ).fetchall()
        return [TileLocation.model_validate(dict(row)) for row in rows]

    def close(self) -> None:
        with self._lock:
            self._connection.close()
