from datetime import UTC, datetime
from pathlib import Path

from src.services.history_store import TileHistoryStore
from src.services.models import TileLocation
from src.tools.merge_tile_history_backups import discover_backup_files, merge_backups_into_primary


def _record_points(db_path: Path, tile_uuid: str, offsets: list[int]) -> None:
    store = TileHistoryStore(db_path=str(db_path), max_points_per_tile=0)
    store.record(
        [
            TileLocation(
                tile_uuid=tile_uuid,
                latitude=38.0 + (offset * 0.001),
                longitude=-81.0 - (offset * 0.001),
                observed_at=datetime(2026, 7, 1, 12, offset, tzinfo=UTC),
                label="Tile Merge",
            )
            for offset in offsets
        ]
    )
    store.close()


def test_merge_backups_into_primary_merges_rows_and_deduplicates(tmp_path) -> None:
    primary = tmp_path / "tile_history.db"
    backup_one = tmp_path / "tile_history.db.20260701.bak"
    backup_two = tmp_path / "tile_history.db.20260702.bak"

    _record_points(primary, "device_tracker.tile_merge", [0])
    _record_points(backup_one, "device_tracker.tile_merge", [0, 1])
    _record_points(backup_two, "device_tracker.tile_merge", [2, 3])

    stats = merge_backups_into_primary(primary, [backup_one, backup_two], run_vacuum=False)

    assert stats.processed_files == 2
    assert stats.processed_rows == 4

    store = TileHistoryStore(db_path=str(primary), max_points_per_tile=0)
    merged = store.get_history("device_tracker.tile_merge")
    store.close()

    # offset 0 exists in both primary + backup_one, so final merged set is unique per second.
    assert len(merged) == 4
    assert merged[0].observed_at.isoformat() == "2026-07-01T12:00:00+00:00"
    assert merged[-1].observed_at.isoformat() == "2026-07-01T12:03:00+00:00"


def test_discover_backup_files_finds_all_bak_files(tmp_path) -> None:
    primary = tmp_path / "tile_history.db"
    primary.write_text("", encoding="utf-8")

    (tmp_path / "tile_history.db.1.bak").write_text("", encoding="utf-8")
    (tmp_path / "tile_history.db.2.bak").write_text("", encoding="utf-8")
    (tmp_path / "other.txt").write_text("", encoding="utf-8")

    backups = discover_backup_files(primary)

    assert [path.name for path in backups] == [
        "tile_history.db.1.bak",
        "tile_history.db.2.bak",
    ]
