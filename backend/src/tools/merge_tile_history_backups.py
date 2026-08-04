from __future__ import annotations

import argparse
import sqlite3
from dataclasses import dataclass
from pathlib import Path

UPSERT_SQL = """
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
"""


@dataclass(slots=True)
class MergeStats:
    processed_files: int = 0
    processed_rows: int = 0


def _ensure_primary_schema(connection: sqlite3.Connection) -> None:
    connection.execute(
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
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_tile_history_tile_observed
        ON tile_history (tile_uuid, observed_at DESC)
        """
    )
    connection.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_tile_history_tile_second
        ON tile_history (tile_uuid, observed_at_second)
        """
    )


def _has_table(connection: sqlite3.Connection, table_name: str) -> bool:
    row = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1",
        (table_name,),
    ).fetchone()
    return row is not None


def _build_source_select(columns: set[str]) -> str:
    label_expr = "label" if "label" in columns else "''"
    tile_service_expr = "tile_service_observed_at" if "tile_service_observed_at" in columns else "NULL"
    polled_expr = "polled_at" if "polled_at" in columns else "NULL"

    if "observed_at_second" in columns:
        observed_second_expr = "observed_at_second"
    else:
        observed_second_expr = (
            "CASE "
            "WHEN instr(observed_at, '.') > 0 THEN substr(observed_at, 1, instr(observed_at, '.') - 1) "
            "ELSE observed_at END"
        )

    return f"""
        SELECT
            tile_uuid,
            {label_expr} AS label,
            latitude,
            longitude,
            observed_at,
            {tile_service_expr} AS tile_service_observed_at,
            {polled_expr} AS polled_at,
            {observed_second_expr} AS observed_at_second
        FROM tile_history
    """


def merge_backups_into_primary(
    primary_db: Path,
    backup_files: list[Path],
    batch_size: int = 5000,
    run_vacuum: bool = True,
) -> MergeStats:
    primary_db.parent.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(primary_db) as destination:
        destination.execute("PRAGMA journal_mode=WAL")
        destination.execute("PRAGMA synchronous=NORMAL")
        _ensure_primary_schema(destination)

        stats = MergeStats()
        for backup_path in backup_files:
            with sqlite3.connect(backup_path) as source:
                if not _has_table(source, "tile_history"):
                    continue

                columns = {
                    row[1]
                    for row in source.execute("PRAGMA table_info(tile_history)").fetchall()
                }

                required = {"tile_uuid", "latitude", "longitude", "observed_at"}
                if not required.issubset(columns):
                    continue

                select_sql = _build_source_select(columns)
                cursor = source.execute(select_sql)

                while True:
                    rows = cursor.fetchmany(batch_size)
                    if not rows:
                        break
                    destination.executemany(UPSERT_SQL, rows)
                    stats.processed_rows += len(rows)

                stats.processed_files += 1
                destination.commit()

        destination.execute("ANALYZE")
        if run_vacuum:
            destination.execute("VACUUM")

    return stats


def discover_backup_files(primary_db: Path, pattern: str = "*.bak") -> list[Path]:
    return sorted(path for path in primary_db.parent.glob(pattern) if path.is_file())


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Merge SQLite tile history backup files (.bak) into the primary tile_history.db",
    )
    parser.add_argument(
        "--db",
        default="/app/data/tile_history.db",
        help="Path to the primary tile history database",
    )
    parser.add_argument(
        "--pattern",
        default="*.bak",
        help="Glob pattern used to find backup files in the DB directory",
    )
    parser.add_argument(
        "--no-vacuum",
        action="store_true",
        help="Skip VACUUM after merge",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    primary_db = Path(args.db).expanduser().resolve()
    backup_files = discover_backup_files(primary_db, pattern=args.pattern)

    if not backup_files:
        print(f"No backup files found for pattern '{args.pattern}' in {primary_db.parent}")
        return 0

    print(f"Merging {len(backup_files)} backup files into {primary_db}...")
    stats = merge_backups_into_primary(
        primary_db,
        backup_files,
        run_vacuum=not args.no_vacuum,
    )
    print(
        "Merge complete: "
        f"files={stats.processed_files}, rows_processed={stats.processed_rows}, "
        f"vacuum={'no' if args.no_vacuum else 'yes'}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
