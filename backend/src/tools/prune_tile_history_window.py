from __future__ import annotations

import argparse
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

DEFAULT_START = "2026-07-22T06:00:00-04:00"
DEFAULT_END = "2026-07-31T17:00:00-04:00"


@dataclass(slots=True)
class PruneStats:
    before_count: int
    after_count: int

    @property
    def deleted_count(self) -> int:
        return self.before_count - self.after_count


def _parse_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        # Treat naive values as UTC so behavior stays explicit and deterministic.
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _count_rows(connection: sqlite3.Connection) -> int:
    row = connection.execute("SELECT COUNT(*) FROM tile_history").fetchone()
    return int(row[0]) if row is not None else 0


def prune_history_to_window(
    db_path: Path,
    keep_start: datetime,
    keep_end: datetime,
    run_vacuum: bool = True,
) -> PruneStats:
    if keep_end < keep_start:
        raise ValueError("keep_end must be greater than or equal to keep_start")

    with sqlite3.connect(db_path) as connection:
        has_table = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='tile_history' LIMIT 1"
        ).fetchone()
        if has_table is None:
            return PruneStats(before_count=0, after_count=0)

        before_count = _count_rows(connection)
        connection.execute(
            "DELETE FROM tile_history WHERE observed_at < ? OR observed_at > ?",
            (keep_start.isoformat(), keep_end.isoformat()),
        )
        connection.commit()

        if run_vacuum:
            connection.execute("VACUUM")

        after_count = _count_rows(connection)

    return PruneStats(before_count=before_count, after_count=after_count)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Prune tile_history to a single date window by deleting points outside the range.",
    )
    parser.add_argument(
        "--db",
        default="/app/data/tile_history.db",
        help="Path to the primary tile history database",
    )
    parser.add_argument(
        "--start",
        default=DEFAULT_START,
        help=(
            "Keep window start in ISO8601 format. Default keeps data from "
            "2026-07-22 06:00 EDT."
        ),
    )
    parser.add_argument(
        "--end",
        default=DEFAULT_END,
        help=(
            "Keep window end in ISO8601 format. Default keeps data through "
            "2026-07-31 17:00 EDT."
        ),
    )
    parser.add_argument(
        "--no-vacuum",
        action="store_true",
        help="Skip VACUUM after deleting rows.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    db_path = Path(args.db).expanduser().resolve()
    keep_start = _parse_datetime(args.start)
    keep_end = _parse_datetime(args.end)

    stats = prune_history_to_window(
        db_path=db_path,
        keep_start=keep_start,
        keep_end=keep_end,
        run_vacuum=not args.no_vacuum,
    )

    print(
        "Prune complete: "
        f"before={stats.before_count}, after={stats.after_count}, deleted={stats.deleted_count}, "
        f"window_utc=[{keep_start.isoformat()} .. {keep_end.isoformat()}], "
        f"vacuum={'no' if args.no_vacuum else 'yes'}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
