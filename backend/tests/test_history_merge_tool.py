from datetime import UTC, datetime
from pathlib import Path
import sqlite3

from src.services.history_store import TileHistoryStore
from src.services.models import TileLocation
from src.tools.merge_tile_history_backups import (
    archive_backup_files,
    discover_backup_files,
    merge_backups_into_primary,
)


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
    assert stats.history_rows == 4

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


def test_merge_backups_into_primary_restores_custom_areas(tmp_path) -> None:
    primary = tmp_path / "tile_history.db"
    backup = tmp_path / "tile_history.db.areas.bak"

    _record_points(primary, "device_tracker.tile_merge", [0])
    _record_points(backup, "device_tracker.tile_merge", [1])

    with sqlite3.connect(backup) as connection:
        connection.execute(
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
        connection.execute(
            """
            INSERT INTO custom_areas (
                area_id,
                tile_uuid,
                name,
                polygon_json,
                created_at,
                updated_at,
                source_type,
                source_name,
                source_url,
                source_feature_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "area-1",
                "global",
                "Recovered Area",
                '[{"latitude": 38.0, "longitude": -81.0}, {"latitude": 38.001, "longitude": -81.0}, {"latitude": 38.0005, "longitude": -80.999}]',
                "2026-07-01T00:00:00+00:00",
                "2026-07-01T00:00:00+00:00",
                "mymaps_kml_polygon",
                "My Maps",
                "https://example.com/kml",
                "feature:1",
            ),
        )
        connection.commit()

    stats = merge_backups_into_primary(primary, [backup], run_vacuum=False)
    assert stats.custom_area_rows == 1

    with sqlite3.connect(primary) as connection:
        row = connection.execute(
            "SELECT name, tile_uuid FROM custom_areas WHERE area_id = ?",
            ("area-1",),
        ).fetchone()

    assert row is not None
    assert row[0] == "Recovered Area"
    assert row[1] == "global"


def test_archive_backup_files_moves_bak_files_into_merged_folder(tmp_path) -> None:
    primary = tmp_path / "tile_history.db"
    backup_one = tmp_path / "tile_history.db.1.bak"
    backup_two = tmp_path / "tile_history.db.2.bak"
    primary.write_text("", encoding="utf-8")
    backup_one.write_text("one", encoding="utf-8")
    backup_two.write_text("two", encoding="utf-8")

    archive_dir = tmp_path / "merged"
    moved = archive_backup_files([backup_one, backup_two], archive_dir)

    assert moved == 2
    assert not backup_one.exists()
    assert not backup_two.exists()
    assert (archive_dir / backup_one.name).exists()
    assert (archive_dir / backup_two.name).exists()
