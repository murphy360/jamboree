from datetime import UTC, datetime
from pathlib import Path

from src.services.history_store import TileHistoryStore
from src.services.models import TileLocation
from src.tools.prune_tile_history_window import prune_history_to_window


def _record_point(db_path: Path, minute: int) -> None:
    store = TileHistoryStore(db_path=str(db_path), max_points_per_tile=0)
    store.record(
        [
            TileLocation(
                tile_uuid="device_tracker.window_tile",
                latitude=38.0 + (minute * 0.0001),
                longitude=-81.0 - (minute * 0.0001),
                observed_at=datetime(2026, 7, 22, 10, minute, tzinfo=UTC),
                label="Window Tile",
            )
        ]
    )
    store.close()


def test_prune_history_to_window_removes_outside_rows(tmp_path) -> None:
    db_path = tmp_path / "tile_history.db"

    # UTC values here correspond to EDT window edges and surrounding points.
    _record_point(db_path, 59)  # before window start
    _record_point(db_path, 0)   # exactly at start boundary
    _record_point(db_path, 1)   # inside window

    keep_start = datetime(2026, 7, 22, 10, 0, tzinfo=UTC)
    keep_end = datetime(2026, 7, 22, 10, 1, tzinfo=UTC)

    stats = prune_history_to_window(
        db_path=db_path,
        keep_start=keep_start,
        keep_end=keep_end,
        run_vacuum=False,
    )

    assert stats.before_count == 3
    assert stats.after_count == 2
    assert stats.deleted_count == 1

    store = TileHistoryStore(db_path=str(db_path), max_points_per_tile=0)
    history = store.get_history("device_tracker.window_tile")
    store.close()

    assert len(history) == 2
    assert history[0].observed_at.isoformat() == "2026-07-22T10:00:00+00:00"
    assert history[1].observed_at.isoformat() == "2026-07-22T10:01:00+00:00"
