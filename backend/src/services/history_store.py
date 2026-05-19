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
                    observed_at_second TEXT NOT NULL,
                    PRIMARY KEY (tile_uuid, observed_at_second)
                )
                """
            )
            self._connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_tile_history_tile_observed
                ON tile_history (tile_uuid, observed_at DESC)
                """
            )
            self._connection.commit()

    def record(self, locations: list[TileLocation]) -> None:
        with self._lock:
            self._record_locked(locations)

    def _record_locked(self, locations: list[TileLocation]) -> None:
        touched_tiles: set[str] = set()

        for location in locations:
            touched_tiles.add(location.tile_uuid)
            observed_at_second = location.observed_at.replace(microsecond=0).isoformat()

            # De-duplicate per tile by second while still allowing updates within that second.
            self._connection.execute(
                """
                INSERT INTO tile_history (
                    tile_uuid,
                    label,
                    latitude,
                    longitude,
                    observed_at,
                    observed_at_second
                )
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(tile_uuid, observed_at_second)
                DO UPDATE SET
                    label = excluded.label,
                    latitude = excluded.latitude,
                    longitude = excluded.longitude,
                    observed_at = excluded.observed_at
                """,
                (
                    location.tile_uuid,
                    location.label,
                    location.latitude,
                    location.longitude,
                    location.observed_at.isoformat(),
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

    def get_history(self, tile_uuid: str) -> list[TileLocation]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT tile_uuid, latitude, longitude, observed_at, label
                FROM tile_history
                WHERE tile_uuid = ?
                ORDER BY observed_at ASC
                """,
                (tile_uuid,),
            ).fetchall()
        return [TileLocation.model_validate(dict(row)) for row in rows]

    def close(self) -> None:
        with self._lock:
            self._connection.close()
