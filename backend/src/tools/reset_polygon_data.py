from __future__ import annotations

import argparse
import sqlite3
from dataclasses import dataclass
from pathlib import Path


@dataclass(slots=True)
class ResetPolygonStats:
    custom_area_rows_deleted: int = 0
    map_feature_rows_deleted: int = 0
    merge_event_rows_deleted: int = 0


def _has_table(connection: sqlite3.Connection, table_name: str) -> bool:
    row = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1",
        (table_name,),
    ).fetchone()
    return row is not None


def reset_polygon_data(db_path: Path, run_vacuum: bool = True) -> ResetPolygonStats:
    stats = ResetPolygonStats()

    with sqlite3.connect(db_path) as connection:
        connection.execute("PRAGMA journal_mode=WAL")

        if _has_table(connection, "custom_areas"):
            cursor = connection.execute("DELETE FROM custom_areas")
            stats.custom_area_rows_deleted = cursor.rowcount

        if _has_table(connection, "map_features"):
            cursor = connection.execute("DELETE FROM map_features")
            stats.map_feature_rows_deleted = cursor.rowcount

        if _has_table(connection, "custom_area_merge_events"):
            cursor = connection.execute("DELETE FROM custom_area_merge_events")
            stats.merge_event_rows_deleted = cursor.rowcount

        connection.commit()
        if run_vacuum:
            connection.execute("VACUUM")

    return stats


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Remove all polygon data while preserving tile_history tracker rows.",
    )
    parser.add_argument(
        "--db",
        default="/app/data/tile_history.db",
        help="Path to the primary tile history database",
    )
    parser.add_argument(
        "--no-vacuum",
        action="store_true",
        help="Skip VACUUM after clearing polygon tables.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    db_path = Path(args.db).expanduser().resolve()
    stats = reset_polygon_data(db_path, run_vacuum=not args.no_vacuum)

    print(
        "Polygon reset complete: "
        f"custom_areas_deleted={stats.custom_area_rows_deleted}, "
        f"map_features_deleted={stats.map_feature_rows_deleted}, "
        f"merge_events_deleted={stats.merge_event_rows_deleted}, "
        f"vacuum={'no' if args.no_vacuum else 'yes'}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())