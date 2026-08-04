from __future__ import annotations

import argparse
import json
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from src.services.area_store import convex_hull


@dataclass(slots=True)
class MergeBarrStats:
    matched_areas: int = 0
    merged_groups: int = 0
    deleted_areas: int = 0


def _load_matching_areas(
    connection: sqlite3.Connection,
    source_prefix: str,
    tile_uuid: str | None,
) -> list[sqlite3.Row]:
    query = """
        SELECT area_id, tile_uuid, name, polygon_json
        FROM custom_areas
        WHERE lower(name) LIKE lower(?)
    """
    params: list[str] = [f"{source_prefix}%"]
    if tile_uuid:
        query += " AND tile_uuid = ?"
        params.append(tile_uuid)
    query += " ORDER BY created_at ASC"
    return connection.execute(query, params).fetchall()


def merge_barr_polygons(
    db_path: Path,
    source_prefix: str = "BARR",
    target_name: str = "Barrels",
    tile_uuid: str | None = None,
) -> MergeBarrStats:
    stats = MergeBarrStats()

    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row

        has_table = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='custom_areas' LIMIT 1"
        ).fetchone()
        if has_table is None:
            return stats

        rows = _load_matching_areas(connection, source_prefix=source_prefix, tile_uuid=tile_uuid)
        stats.matched_areas = len(rows)
        if not rows:
            return stats

        grouped: dict[str, list[sqlite3.Row]] = {}
        for row in rows:
            grouped.setdefault(row["tile_uuid"], []).append(row)

        now = datetime.now(UTC).isoformat()

        for group_tile_uuid, group_rows in grouped.items():
            all_points: list[tuple[float, float]] = []
            for row in group_rows:
                polygon_points = json.loads(row["polygon_json"])
                for point in polygon_points:
                    all_points.append((point["latitude"], point["longitude"]))

            # Need at least 3 non-collinear points for a valid polygon hull.
            hull_points = convex_hull(all_points)
            polygon_json = json.dumps(
                [
                    {"latitude": latitude, "longitude": longitude}
                    for latitude, longitude in hull_points
                ]
            )

            target_row = next(
                (row for row in group_rows if row["name"].strip().lower() == target_name.lower()),
                group_rows[0],
            )
            keep_area_id = target_row["area_id"]

            connection.execute(
                """
                UPDATE custom_areas
                SET name = ?, polygon_json = ?, updated_at = ?
                WHERE area_id = ?
                """,
                (target_name, polygon_json, now, keep_area_id),
            )

            delete_ids = [row["area_id"] for row in group_rows if row["area_id"] != keep_area_id]
            if delete_ids:
                placeholders = ",".join("?" for _ in delete_ids)
                connection.execute(
                    f"DELETE FROM custom_areas WHERE area_id IN ({placeholders})",
                    delete_ids,
                )

            stats.merged_groups += 1
            stats.deleted_areas += len(delete_ids)

        connection.commit()

    return stats


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Merge all BARR* custom-area polygons into a single Barrels polygon.",
    )
    parser.add_argument(
        "--db",
        default="/app/data/tile_history.db",
        help="Path to the primary tile history database",
    )
    parser.add_argument(
        "--source-prefix",
        default="BARR",
        help="Case-insensitive name prefix to merge (default: BARR)",
    )
    parser.add_argument(
        "--target-name",
        default="Barrels",
        help="Name to assign the merged polygon (default: Barrels)",
    )
    parser.add_argument(
        "--tile-uuid",
        default=None,
        help="Optional tile UUID scope (for example: global)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    stats = merge_barr_polygons(
        db_path=Path(args.db).expanduser().resolve(),
        source_prefix=args.source_prefix,
        target_name=args.target_name,
        tile_uuid=args.tile_uuid,
    )

    print(
        "Merge complete: "
        f"matched_areas={stats.matched_areas}, "
        f"merged_groups={stats.merged_groups}, "
        f"deleted_areas={stats.deleted_areas}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
