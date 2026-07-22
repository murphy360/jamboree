from __future__ import annotations

import sqlite3
from collections import defaultdict
from math import asin, cos, radians, sin, sqrt
from pathlib import Path
from threading import Lock

from src.services.area_store import point_in_polygon
from src.services.models import CustomArea, TileDailySummary, TileDwellCluster, TileLocation


def _haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    earth_radius_m = 6_371_000.0
    d_lat = radians(lat2 - lat1)
    d_lon = radians(lon2 - lon1)
    a = sin(d_lat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(d_lon / 2) ** 2
    c = 2 * asin(sqrt(a))
    return earth_radius_m * c


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

        if self._max_points_per_tile > 0:
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

    def build_daily_breakdown(self, history: list[TileLocation]) -> list[TileDailySummary]:
        grouped: dict[str, list[TileLocation]] = defaultdict(list)

        for point in history:
            grouped[point.observed_at.date().isoformat()].append(point)

        summaries: list[TileDailySummary] = []
        for date in sorted(grouped.keys()):
            points = grouped[date]
            start = points[0].observed_at
            end = points[-1].observed_at
            span_minutes = int(max(0, (end - start).total_seconds()) // 60)
            summaries.append(
                TileDailySummary(
                    date=date,
                    point_count=len(points),
                    start_observed_at=start,
                    end_observed_at=end,
                    total_span_minutes=span_minutes,
                )
            )

        return summaries

    def build_dwell_clusters(
        self,
        history: list[TileLocation],
        max_gap_minutes: int = 30,
        merge_radius_meters: float = 50.0,
        areas: list[CustomArea] | None = None,
    ) -> list[TileDwellCluster]:
        if not history:
            return []

        if areas:
            history = [
                pt for pt in history
                if not any(point_in_polygon(pt.latitude, pt.longitude, a.polygon) for a in areas)
            ]

        per_cluster: list[dict[str, float | int]] = []
        max_gap_seconds = max_gap_minutes * 60

        for index, point in enumerate(history):
            record = self._find_cluster(per_cluster, point.latitude, point.longitude, merge_radius_meters)
            if record is None:
                record = {
                    "latitude_sum": 0.0,
                    "longitude_sum": 0.0,
                    "samples": 0,
                    "seconds_spent": 0,
                }
                per_cluster.append(record)

            record["latitude_sum"] = float(record["latitude_sum"]) + point.latitude
            record["longitude_sum"] = float(record["longitude_sum"]) + point.longitude
            record["samples"] = int(record["samples"]) + 1

            if index == len(history) - 1:
                continue

            next_point = history[index + 1]
            gap_seconds = int((next_point.observed_at - point.observed_at).total_seconds())
            bounded_gap = min(max(gap_seconds, 0), max_gap_seconds)
            record["seconds_spent"] = int(record["seconds_spent"]) + bounded_gap

        clusters: list[TileDwellCluster] = []
        for record in per_cluster:
            samples = int(record["samples"])
            if samples <= 0:
                continue

            seconds_spent = int(record["seconds_spent"])
            minutes_spent = int(seconds_spent // 60)
            clusters.append(
                TileDwellCluster(
                    latitude=float(record["latitude_sum"]) / samples,
                    longitude=float(record["longitude_sum"]) / samples,
                    samples=samples,
                    minutes_spent=minutes_spent,
                )
            )

        clusters.sort(key=lambda item: (item.minutes_spent, item.samples), reverse=True)
        return clusters

    def _find_cluster(
        self,
        clusters: list[dict[str, float | int]],
        latitude: float,
        longitude: float,
        merge_radius_meters: float,
    ) -> dict[str, float | int] | None:
        best_cluster: dict[str, float | int] | None = None
        best_distance = float("inf")

        for cluster in clusters:
            samples = int(cluster["samples"])
            if samples <= 0:
                continue

            center_lat = float(cluster["latitude_sum"]) / samples
            center_lon = float(cluster["longitude_sum"]) / samples
            distance = _haversine_meters(latitude, longitude, center_lat, center_lon)
            if distance <= merge_radius_meters and distance < best_distance:
                best_cluster = cluster
                best_distance = distance

        return best_cluster

    def get_all_tile_identifiers(self) -> list[tuple[str, str]]:
        """Return (tile_uuid, label) for all tiles that have history, using the latest label."""
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT h.tile_uuid, h.label
                FROM tile_history h
                WHERE h.rowid = (
                    SELECT x.rowid
                    FROM tile_history x
                    WHERE x.tile_uuid = h.tile_uuid
                    ORDER BY x.observed_at DESC, x.rowid DESC
                    LIMIT 1
                )
                ORDER BY h.label ASC
                """
            ).fetchall()
        return [(row["tile_uuid"], row["label"]) for row in rows]

    def delete_tile_history(self, tile_uuid: str) -> int:
        """Delete all stored history rows for a tile and return deleted row count."""
        with self._lock:
            cursor = self._connection.execute(
                "DELETE FROM tile_history WHERE tile_uuid = ?",
                (tile_uuid,),
            )
            self._connection.commit()
        return cursor.rowcount

    def delete_all_history(self) -> int:
        """Delete all tracker history rows and return deleted row count."""
        with self._lock:
            cursor = self._connection.execute("DELETE FROM tile_history")
            self._connection.commit()
        return cursor.rowcount

    def close(self) -> None:
        with self._lock:
            self._connection.close()
