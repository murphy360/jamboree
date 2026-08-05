"""Persistent storage and spatial logic for named custom areas."""

from __future__ import annotations

import json
import math
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from threading import Lock
from typing import Any

from shapely.geometry import Polygon
from shapely.ops import unary_union

from src.services.models import AreaPolygonPoint, CustomArea, TileLocation


@dataclass(frozen=True)
class ImportedAreaSource:
    source_type: str
    source_name: str
    source_url: str
    source_feature_id: str


# ---------------------------------------------------------------------------
# Spatial utilities
# ---------------------------------------------------------------------------


def _hull_cross(
    origin: tuple[float, float],
    point_a: tuple[float, float],
    point_b: tuple[float, float],
) -> float:
    """Cross product of vectors origin→A and origin→B using (lat, lon) tuples."""
    return (point_a[0] - origin[0]) * (point_b[1] - origin[1]) - (
        point_a[1] - origin[1]
    ) * (point_b[0] - origin[0])


def convex_hull(
    points: list[tuple[float, float]],
) -> list[tuple[float, float]]:
    """Compute the convex hull of (lat, lon) pairs using Andrew's monotone chain.

    Returns the hull vertices in counter-clockwise order.
    Raises ValueError when fewer than 3 non-collinear points are provided.
    """
    pts = sorted(set(points))
    if len(pts) < 3:
        raise ValueError("At least 3 distinct cluster centers are required.")

    lower: list[tuple[float, float]] = []
    for p in pts:
        while len(lower) >= 2 and _hull_cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)

    upper: list[tuple[float, float]] = []
    for p in reversed(pts):
        while len(upper) >= 2 and _hull_cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)

    hull = lower[:-1] + upper[:-1]
    if len(hull) < 3:
        raise ValueError(
            "Selected clusters are collinear; choose non-collinear hotspots to form an area."
        )
    return hull


def point_in_polygon(
    lat: float, lon: float, polygon: list[AreaPolygonPoint]
) -> bool:
    """Ray-casting test: True if (lat, lon) is inside the closed polygon."""
    n = len(polygon)
    if n < 3:
        return False

    epsilon = 1e-9

    def point_on_segment(
        point_lat: float,
        point_lon: float,
        start_lat: float,
        start_lon: float,
        end_lat: float,
        end_lon: float,
    ) -> bool:
        cross = (point_lat - start_lat) * (end_lon - start_lon) - (
            point_lon - start_lon
        ) * (end_lat - start_lat)
        if abs(cross) > epsilon:
            return False

        dot = (point_lat - start_lat) * (end_lat - start_lat) + (
            point_lon - start_lon
        ) * (end_lon - start_lon)
        if dot < -epsilon:
            return False

        squared_len = (end_lat - start_lat) ** 2 + (end_lon - start_lon) ** 2
        return dot <= squared_len + epsilon

    inside = False
    j = n - 1
    for i in range(n):
        pi_lat = polygon[i].latitude
        pi_lon = polygon[i].longitude
        pj_lat = polygon[j].latitude
        pj_lon = polygon[j].longitude

        if point_on_segment(lat, lon, pi_lat, pi_lon, pj_lat, pj_lon):
            return True

        lon_crosses = (pi_lon > lon) != (pj_lon > lon)
        if lon_crosses:
            lat_intersect = (pj_lat - pi_lat) * (lon - pi_lon) / (
                pj_lon - pi_lon
            ) + pi_lat
            if lat < lat_intersect:
                inside = not inside
        j = i

    return inside


def _to_shapely_polygon(points: list[tuple[float, float]]) -> Polygon | None:
    if len(points) < 3:
        return None

    # Shapely uses (x, y) = (longitude, latitude).
    geometry = Polygon([(lon, lat) for lat, lon in points])
    if not geometry.is_valid:
        geometry = geometry.buffer(0)
    if geometry.is_empty or geometry.geom_type != "Polygon":
        return None
    return geometry


def _polygon_exterior_to_latlon(polygon: Polygon) -> list[tuple[float, float]]:
    coordinates = list(polygon.exterior.coords)
    if len(coordinates) > 1 and coordinates[0] == coordinates[-1]:
        coordinates = coordinates[:-1]
    return [(lat, lon) for lon, lat in coordinates]


def merge_polygons_preserving_shape(
    polygons: list[list[tuple[float, float]]],
    buffer_polygons: list[list[tuple[float, float]]] | None = None,
) -> list[tuple[float, float]] | None:
    geometries: list[Polygon] = []

    for polygon_points in polygons:
        geometry = _to_shapely_polygon(polygon_points)
        if geometry is not None:
            geometries.append(geometry)

    for polygon_points in buffer_polygons or []:
        geometry = _to_shapely_polygon(polygon_points)
        if geometry is not None:
            geometries.append(geometry)

    if not geometries:
        return None

    merged = unary_union(geometries)
    if merged.is_empty:
        return None

    if merged.geom_type == "Polygon":
        return _polygon_exterior_to_latlon(merged)

    # Multi-part results cannot be represented with the current single-polygon model.
    return None


# ---------------------------------------------------------------------------
# AreaStore
# ---------------------------------------------------------------------------


class AreaStore:
    """Manages persistence and stats for custom named areas."""

    def __init__(self, db_path: str) -> None:
        self._lock = Lock()
        db_file = Path(db_path)
        db_file.parent.mkdir(parents=True, exist_ok=True)
        self._connection = sqlite3.connect(str(db_file), check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        self._connection.execute("PRAGMA journal_mode=WAL")
        self._init_schema()

    def _init_schema(self) -> None:
        with self._lock:
            self._connection.execute(
                """
                CREATE TABLE IF NOT EXISTS custom_areas (
                    area_id TEXT PRIMARY KEY,
                    tile_uuid TEXT NOT NULL,
                    name TEXT NOT NULL,
                    polygon_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    source_type TEXT NOT NULL DEFAULT 'manual',
                    source_name TEXT,
                    source_url TEXT,
                    source_feature_id TEXT
                )
                """
            )
            self._connection.execute(
                """
                CREATE TABLE IF NOT EXISTS custom_area_merge_events (
                    event_id TEXT PRIMARY KEY,
                    tile_uuid TEXT NOT NULL,
                    merge_into_area_id TEXT NOT NULL,
                    target_before_json TEXT NOT NULL,
                    source_areas_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    undone_at TEXT
                )
                """
            )
            self._ensure_columns()
            self._connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_custom_areas_tile
                ON custom_areas (tile_uuid)
                """
            )
            self._connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_custom_area_merge_events_tile_target_created
                ON custom_area_merge_events (tile_uuid, merge_into_area_id, created_at DESC)
                """
            )
            self._connection.commit()

    def _ensure_columns(self) -> None:
        columns = {
            row["name"]
            for row in self._connection.execute("PRAGMA table_info(custom_areas)").fetchall()
        }

        statements = {
            "source_type": "ALTER TABLE custom_areas ADD COLUMN source_type TEXT NOT NULL DEFAULT 'manual'",
            "source_name": "ALTER TABLE custom_areas ADD COLUMN source_name TEXT",
            "source_url": "ALTER TABLE custom_areas ADD COLUMN source_url TEXT",
            "source_feature_id": "ALTER TABLE custom_areas ADD COLUMN source_feature_id TEXT",
        }

        for column_name, statement in statements.items():
            if column_name not in columns:
                self._connection.execute(statement)

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------

    def create_area(
        self,
        tile_uuid: str,
        name: str,
        cluster_centers: list[AreaPolygonPoint | tuple[float, float]],
        source_type: str = "manual",
        source_name: str | None = None,
        source_url: str | None = None,
        source_feature_id: str | None = None,
    ) -> CustomArea:
        """Compute convex hull of cluster centers and persist the area."""
        raw_points: list[tuple[float, float]] = []
        for center in cluster_centers:
            if isinstance(center, tuple):
                raw_points.append((center[0], center[1]))
            else:
                raw_points.append((center.latitude, center.longitude))
        hull = convex_hull(raw_points)
        polygon = [AreaPolygonPoint(latitude=lat, longitude=lon) for lat, lon in hull]
        area_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()
        polygon_json = json.dumps(
            [{"latitude": p.latitude, "longitude": p.longitude} for p in polygon]
        )

        with self._lock:
            self._connection.execute(
                """
                INSERT INTO custom_areas
                    (area_id, tile_uuid, name, polygon_json, created_at, updated_at, source_type, source_name, source_url, source_feature_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    area_id,
                    tile_uuid,
                    name,
                    polygon_json,
                    now,
                    now,
                    source_type,
                    source_name,
                    source_url,
                    source_feature_id,
                ),
            )
            self._connection.commit()

        return CustomArea(
            area_id=area_id,
            tile_uuid=tile_uuid,
            name=name,
            polygon=polygon,
            created_at=datetime.fromisoformat(now),
            updated_at=datetime.fromisoformat(now),
            source_type=source_type,
            source_name=source_name,
            source_url=source_url,
            source_feature_id=source_feature_id,
        )

    def merge_area(
        self,
        tile_uuid: str,
        merge_into_area_id: str,
        cluster_centers: list[AreaPolygonPoint],
        hotspot_centers: list[AreaPolygonPoint] | None = None,
        merge_source_area_ids: list[str] | None = None,
        hotspot_buffer_meters: float = 50,
    ) -> CustomArea:
        merge_source_area_ids = merge_source_area_ids or []
        hotspot_centers = hotspot_centers or []
        target = self._get_area_by_id(merge_into_area_id)

        source_ids: list[str] = []
        seen_source_ids: set[str] = set()
        for area_id in merge_source_area_ids:
            if area_id == merge_into_area_id or area_id in seen_source_ids:
                continue
            seen_source_ids.add(area_id)
            source_ids.append(area_id)
        source_areas = [self._get_area_by_id(area_id) for area_id in source_ids]
        if any(area is None for area in source_areas):
            raise ValueError("One or more merge source areas were not found.")

        validated_sources = []
        for area in source_areas:
            assert area is not None
            validated_sources.append(area)

        if target is None:
            if not validated_sources:
                raise ValueError("Merge target area was not found.")

            target = validated_sources[0]
            merge_into_area_id = target.area_id
            source_ids = [area_id for area_id in source_ids if area_id != merge_into_area_id]
            validated_sources = validated_sources[1:]

        target_snapshot = self._serialize_area_snapshot(target)
        source_snapshots = [self._serialize_area_snapshot(area) for area in validated_sources]

        points: list[tuple[float, float]] = [
            (point.latitude, point.longitude) for point in target.polygon
        ]
        points.extend((point.latitude, point.longitude) for point in cluster_centers)
        source_polygons = [
            [(point.latitude, point.longitude) for point in source.polygon]
            for source in validated_sources
        ]
        merge_input_polygons = [
            [(point.latitude, point.longitude) for point in target.polygon],
            *source_polygons,
        ]
        hotspot_buffer_polygons: list[list[tuple[float, float]]] = []
        for center in hotspot_centers:
            buffered = self._buffer_point(
                center.latitude,
                center.longitude,
                hotspot_buffer_meters,
            )
            points.extend(buffered)
            hotspot_buffer_polygons.append(buffered)
        for source in validated_sources:
            points.extend((point.latitude, point.longitude) for point in source.polygon)

        merged_outline = merge_polygons_preserving_shape(
            merge_input_polygons,
            hotspot_buffer_polygons,
        )

        if merged_outline is None:
            merged_outline = convex_hull(points)

        polygon = [
            AreaPolygonPoint(latitude=lat, longitude=lon)
            for lat, lon in merged_outline
        ]
        polygon_json = json.dumps(
            [{"latitude": p.latitude, "longitude": p.longitude} for p in polygon]
        )
        now = datetime.now(UTC).isoformat()
        event_id = str(uuid.uuid4())

        with self._lock:
            try:
                self._connection.execute("BEGIN")
                self._connection.execute(
                    """
                    UPDATE custom_areas
                    SET polygon_json = ?,
                        updated_at = ?,
                        source_type = 'manual',
                        source_name = NULL,
                        source_url = NULL,
                        source_feature_id = NULL
                    WHERE area_id = ?
                    """,
                    (polygon_json, now, merge_into_area_id),
                )

                if source_ids:
                    placeholders = ",".join("?" for _ in source_ids)
                    self._connection.execute(
                        f"DELETE FROM custom_areas WHERE area_id IN ({placeholders})",
                        tuple(source_ids),
                    )

                self._connection.execute(
                    """
                    INSERT INTO custom_area_merge_events
                        (event_id, tile_uuid, merge_into_area_id, target_before_json, source_areas_json, created_at, undone_at)
                    VALUES (?, ?, ?, ?, ?, ?, NULL)
                    """,
                    (
                        event_id,
                        tile_uuid,
                        merge_into_area_id,
                        json.dumps(target_snapshot),
                        json.dumps(source_snapshots),
                        now,
                    ),
                )
                self._connection.commit()
            except Exception:
                self._connection.rollback()
                raise

        updated = self._get_area_by_id(merge_into_area_id)
        if not updated:
            raise ValueError("Merged area could not be loaded after update.")
        return updated

    def get_latest_merge_undo(self, tile_uuid: str) -> tuple[str, str, datetime] | None:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT merge_into_area_id, target_before_json, created_at
                FROM custom_area_merge_events
                WHERE tile_uuid = ? AND undone_at IS NULL
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (tile_uuid,),
            ).fetchone()

        if not row:
            return None

        target_snapshot = json.loads(row["target_before_json"])
        area_name = target_snapshot.get("name", "")
        merged_at = datetime.fromisoformat(row["created_at"])
        return (row["merge_into_area_id"], area_name, merged_at)

    def undo_merge(self, tile_uuid: str, merge_into_area_id: str) -> CustomArea:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT event_id, target_before_json, source_areas_json, created_at
                FROM custom_area_merge_events
                WHERE tile_uuid = ? AND merge_into_area_id = ? AND undone_at IS NULL
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (tile_uuid, merge_into_area_id),
            ).fetchone()

            if not row:
                raise ValueError("No merge is available to undo for this area.")

            restored_at = datetime.now(UTC).isoformat()
            target_snapshot = json.loads(row["target_before_json"])
            source_snapshots = json.loads(row["source_areas_json"])

            try:
                self._connection.execute("BEGIN")
                self._upsert_snapshot(target_snapshot, restored_at)
                for source_snapshot in source_snapshots:
                    self._upsert_snapshot(source_snapshot, restored_at)

                self._connection.execute(
                    "UPDATE custom_area_merge_events SET undone_at = ? WHERE event_id = ?",
                    (restored_at, row["event_id"]),
                )
                self._connection.commit()
            except Exception:
                self._connection.rollback()
                raise

        updated = self._get_area_by_id(merge_into_area_id)
        if not updated:
            raise ValueError("Merged area could not be restored after undo.")
        return updated

    def get_areas(self, tile_uuid: str) -> list[CustomArea]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT area_id, tile_uuid, name, polygon_json, created_at, updated_at, source_type, source_name, source_url, source_feature_id
                FROM custom_areas
                WHERE tile_uuid = ?
                ORDER BY created_at ASC
                """,
                (tile_uuid,),
            ).fetchall()

        return [self._row_to_area(row) for row in rows]

    def update_area(self, area_id: str, name: str) -> CustomArea | None:
        now = datetime.now(UTC).isoformat()
        with self._lock:
            self._connection.execute(
                "UPDATE custom_areas SET name = ?, updated_at = ? WHERE area_id = ?",
                (name, now, area_id),
            )
            self._connection.commit()
            row = self._connection.execute(
                """
                SELECT area_id, tile_uuid, name, polygon_json, created_at, updated_at, source_type, source_name, source_url, source_feature_id
                FROM custom_areas WHERE area_id = ?
                """,
                (area_id,),
            ).fetchone()

        return self._row_to_area(row) if row else None

    def update_area_polygon(self, area_id: str, polygon: list[AreaPolygonPoint]) -> CustomArea | None:
        if len(polygon) < 3:
            raise ValueError("At least 3 points are required to update an area polygon.")

        cleaned_polygon = list(polygon)
        first_point = cleaned_polygon[0]
        last_point = cleaned_polygon[-1]
        if first_point.latitude == last_point.latitude and first_point.longitude == last_point.longitude:
            cleaned_polygon = cleaned_polygon[:-1]

        polygon_json = json.dumps(
            [{"latitude": point.latitude, "longitude": point.longitude} for point in cleaned_polygon]
        )
        now = datetime.now(UTC).isoformat()

        with self._lock:
            self._connection.execute(
                """
                UPDATE custom_areas
                SET polygon_json = ?,
                    updated_at = ?,
                    source_type = 'manual',
                    source_name = NULL,
                    source_url = NULL,
                    source_feature_id = NULL
                WHERE area_id = ?
                """,
                (polygon_json, now, area_id),
            )
            self._connection.commit()
            row = self._connection.execute(
                """
                SELECT area_id, tile_uuid, name, polygon_json, created_at, updated_at, source_type, source_name, source_url, source_feature_id
                FROM custom_areas WHERE area_id = ?
                """,
                (area_id,),
            ).fetchone()

        return self._row_to_area(row) if row else None

    def delete_area(self, area_id: str) -> bool:
        with self._lock:
            cursor = self._connection.execute(
                "DELETE FROM custom_areas WHERE area_id = ?", (area_id,)
            )
            self._connection.commit()
        return cursor.rowcount > 0

    def delete_areas_for_tile(self, tile_uuid: str) -> int:
        with self._lock:
            cursor = self._connection.execute(
                "DELETE FROM custom_areas WHERE tile_uuid = ?",
                (tile_uuid,),
            )
            self._connection.commit()
        return cursor.rowcount

    def delete_areas_by_source(
        self,
        tile_uuid: str,
        source_type: str,
        source_url: str,
    ) -> int:
        with self._lock:
            cursor = self._connection.execute(
                """
                DELETE FROM custom_areas
                WHERE tile_uuid = ? AND source_type = ? AND source_url = ?
                """,
                (tile_uuid, source_type, source_url),
            )
            self._connection.commit()
        return cursor.rowcount

    def delete_non_manual_areas(self, tile_uuid: str) -> int:
        with self._lock:
            cursor = self._connection.execute(
                """
                DELETE FROM custom_areas
                WHERE tile_uuid = ? AND COALESCE(source_type, 'manual') != 'manual'
                """,
                (tile_uuid,),
            )
            self._connection.commit()
        return cursor.rowcount

    def merge_areas_by_name_prefix(
        self,
        tile_uuid: str,
        source_prefix: str,
        target_name: str,
    ) -> tuple[int, int]:
        """Merge all matching prefix areas into one target area.

        Returns (matched_count, deleted_count).
        """
        normalized_prefix = source_prefix.strip()
        normalized_target = target_name.strip()
        if not normalized_prefix or not normalized_target:
            return (0, 0)

        with self._lock:
            rows = self._connection.execute(
                """
                SELECT area_id, name, polygon_json
                FROM custom_areas
                WHERE tile_uuid = ? AND lower(name) LIKE lower(?)
                ORDER BY created_at ASC
                """,
                (tile_uuid, f"{normalized_prefix}%"),
            ).fetchall()

            if not rows:
                return (0, 0)

            all_points: list[tuple[float, float]] = []
            merge_polygons: list[list[tuple[float, float]]] = []
            for row in rows:
                polygon_points = json.loads(row["polygon_json"])
                normalized = [
                    (point["latitude"], point["longitude"])
                    for point in polygon_points
                ]
                merge_polygons.append(normalized)
                all_points.extend(normalized)

            merged_outline = merge_polygons_preserving_shape(merge_polygons)
            if merged_outline is None:
                merged_outline = convex_hull(all_points)

            polygon_json = json.dumps(
                [{"latitude": lat, "longitude": lon} for lat, lon in merged_outline]
            )
            now = datetime.now(UTC).isoformat()

            target_row = next(
                (row for row in rows if row["name"].strip().lower() == normalized_target.lower()),
                rows[0],
            )
            keep_area_id = target_row["area_id"]

            self._connection.execute(
                """
                UPDATE custom_areas
                SET name = ?, polygon_json = ?, updated_at = ?
                WHERE area_id = ?
                """,
                (normalized_target, polygon_json, now, keep_area_id),
            )

            delete_ids = [row["area_id"] for row in rows if row["area_id"] != keep_area_id]
            deleted_count = 0
            if delete_ids:
                placeholders = ",".join("?" for _ in delete_ids)
                cursor = self._connection.execute(
                    f"DELETE FROM custom_areas WHERE area_id IN ({placeholders})",
                    tuple(delete_ids),
                )
                deleted_count = cursor.rowcount

            self._connection.commit()
        return (len(rows), deleted_count)

    # ------------------------------------------------------------------
    # Stats computation
    # ------------------------------------------------------------------

    def compute_area_stats(
        self,
        history: list[TileLocation],
        areas: list[CustomArea],
        max_gap_minutes: int = 30,
    ) -> list[CustomArea]:
        """Return areas with samples and minutes_spent populated from history."""
        max_gap_seconds = max_gap_minutes * 60
        result: list[CustomArea] = []

        for area in areas:
            min_lat = min(point.latitude for point in area.polygon)
            max_lat = max(point.latitude for point in area.polygon)
            min_lon = min(point.longitude for point in area.polygon)
            max_lon = max(point.longitude for point in area.polygon)

            area_points: list[TileLocation] = []
            for pt in history:
                if pt.latitude < min_lat or pt.latitude > max_lat:
                    continue
                if pt.longitude < min_lon or pt.longitude > max_lon:
                    continue
                if point_in_polygon(pt.latitude, pt.longitude, area.polygon):
                    area_points.append(pt)

            samples = len(area_points)
            seconds_spent = 0
            for idx in range(len(area_points) - 1):
                gap = int(
                    (
                        area_points[idx + 1].observed_at - area_points[idx].observed_at
                    ).total_seconds()
                )
                seconds_spent += min(max(gap, 0), max_gap_seconds)

            result.append(
                CustomArea(
                    area_id=area.area_id,
                    tile_uuid=area.tile_uuid,
                    name=area.name,
                    polygon=area.polygon,
                    samples=samples,
                    minutes_spent=seconds_spent // 60,
                    created_at=area.created_at,
                    updated_at=area.updated_at,
                    source_type=area.source_type,
                    source_name=area.source_name,
                    source_url=area.source_url,
                    source_feature_id=area.source_feature_id,
                )
            )

        return result

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _row_to_area(self, row: sqlite3.Row) -> CustomArea:
        polygon = [
            AreaPolygonPoint(latitude=p["latitude"], longitude=p["longitude"])
            for p in json.loads(row["polygon_json"])
        ]
        return CustomArea(
            area_id=row["area_id"],
            tile_uuid=row["tile_uuid"],
            name=row["name"],
            polygon=polygon,
            created_at=datetime.fromisoformat(row["created_at"]),
            updated_at=datetime.fromisoformat(row["updated_at"]),
            source_type=row["source_type"] or "manual",
            source_name=row["source_name"],
            source_url=row["source_url"],
            source_feature_id=row["source_feature_id"],
        )

    def _serialize_area_snapshot(self, area: CustomArea) -> dict[str, Any]:
        return area.model_dump(mode="json")

    def _upsert_snapshot(self, snapshot: dict[str, Any], updated_at: str) -> None:
        polygon_json = json.dumps(snapshot["polygon"])
        self._connection.execute(
            """
            INSERT INTO custom_areas
                (area_id, tile_uuid, name, polygon_json, created_at, updated_at, source_type, source_name, source_url, source_feature_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(area_id) DO UPDATE SET
                tile_uuid = excluded.tile_uuid,
                name = excluded.name,
                polygon_json = excluded.polygon_json,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at,
                source_type = excluded.source_type,
                source_name = excluded.source_name,
                source_url = excluded.source_url,
                source_feature_id = excluded.source_feature_id
            """,
            (
                snapshot["area_id"],
                snapshot["tile_uuid"],
                snapshot["name"],
                polygon_json,
                snapshot["created_at"],
                updated_at,
                snapshot.get("source_type", "manual"),
                snapshot.get("source_name"),
                snapshot.get("source_url"),
                snapshot.get("source_feature_id"),
            ),
        )

    def _get_area_by_id(self, area_id: str) -> CustomArea | None:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT area_id, tile_uuid, name, polygon_json, created_at, updated_at, source_type, source_name, source_url, source_feature_id
                FROM custom_areas
                WHERE area_id = ?
                """,
                (area_id,),
            ).fetchone()
        return self._row_to_area(row) if row else None

    def get_area_by_source(self, source: ImportedAreaSource) -> CustomArea | None:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT area_id, tile_uuid, name, polygon_json, created_at, updated_at, source_type, source_name, source_url, source_feature_id
                FROM custom_areas
                WHERE source_type = ? AND source_url = ? AND source_feature_id = ?
                """,
                (source.source_type, source.source_url, source.source_feature_id),
            ).fetchone()
        return self._row_to_area(row) if row else None

    def upsert_imported_area(
        self,
        tile_uuid: str,
        name: str,
        polygon: list[AreaPolygonPoint],
        source: ImportedAreaSource,
    ) -> CustomArea:
        polygon_json = json.dumps(
            [{"latitude": point.latitude, "longitude": point.longitude} for point in polygon]
        )
        now = datetime.now(UTC).isoformat()
        existing = self.get_area_by_source(source)

        with self._lock:
            if existing:
                self._connection.execute(
                    """
                    UPDATE custom_areas
                    SET tile_uuid = ?, name = ?, polygon_json = ?, updated_at = ?, source_name = ?, source_url = ?, source_feature_id = ?, source_type = ?
                    WHERE area_id = ?
                    """,
                    (
                        tile_uuid,
                        name,
                        polygon_json,
                        now,
                        source.source_name,
                        source.source_url,
                        source.source_feature_id,
                        source.source_type,
                        existing.area_id,
                    ),
                )
                area_id = existing.area_id
            else:
                area_id = str(uuid.uuid4())
                self._connection.execute(
                    """
                    INSERT INTO custom_areas
                        (area_id, tile_uuid, name, polygon_json, created_at, updated_at, source_type, source_name, source_url, source_feature_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        area_id,
                        tile_uuid,
                        name,
                        polygon_json,
                        now,
                        now,
                        source.source_type,
                        source.source_name,
                        source.source_url,
                        source.source_feature_id,
                    ),
                )
            self._connection.commit()

        updated = self._get_area_by_id(area_id)
        if not updated:
            raise ValueError("Imported area could not be loaded after save.")
        return updated

    def _buffer_point(
        self,
        latitude: float,
        longitude: float,
        radius_meters: float,
        sides: int = 12,
    ) -> list[tuple[float, float]]:
        if radius_meters <= 0:
            return [(latitude, longitude)]

        meters_per_degree_lat = 111_320.0
        cos_lat = math.cos(math.radians(latitude))
        meters_per_degree_lon = meters_per_degree_lat * max(abs(cos_lat), 1e-6)
        lat_delta = radius_meters / meters_per_degree_lat
        lon_delta = radius_meters / meters_per_degree_lon

        buffered: list[tuple[float, float]] = []
        for index in range(sides):
            angle = 2 * math.pi * (index / sides)
            buffered.append(
                (
                    latitude + lat_delta * math.sin(angle),
                    longitude + lon_delta * math.cos(angle),
                )
            )
        return buffered

    def close(self) -> None:
        with self._lock:
            self._connection.close()
