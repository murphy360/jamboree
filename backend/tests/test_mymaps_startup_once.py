from __future__ import annotations

import asyncio

from src.main import run_startup_only_mymaps_import, settings


class FakeMyMapsSyncService:
    def __init__(self, should_fail: bool = False) -> None:
        self.should_fail = should_fail
        self.calls = 0

    async def sync_once(self) -> None:
        self.calls += 1
        if self.should_fail:
            raise RuntimeError("sync failed")


def test_startup_only_import_runs_once_and_writes_marker(tmp_path, monkeypatch) -> None:
    marker_path = tmp_path / "mymaps_import_startup.done"

    monkeypatch.setattr(settings, "tile_history_db_path", str(tmp_path / "tile_history.db"))
    monkeypatch.setattr(settings, "mymaps_import_startup_marker_name", marker_path.name)

    fake_service = FakeMyMapsSyncService()
    monkeypatch.setattr("src.main.mymaps_sync_service", fake_service)

    first_run = asyncio.run(run_startup_only_mymaps_import())
    second_run = asyncio.run(run_startup_only_mymaps_import())

    assert first_run is True
    assert second_run is False
    assert fake_service.calls == 1
    assert marker_path.exists()


def test_startup_only_import_skips_when_marker_exists(tmp_path, monkeypatch) -> None:
    marker_path = tmp_path / "mymaps_import_startup.done"
    marker_path.write_text("already imported", encoding="utf-8")

    monkeypatch.setattr(settings, "tile_history_db_path", str(tmp_path / "tile_history.db"))
    monkeypatch.setattr(settings, "mymaps_import_startup_marker_name", marker_path.name)

    fake_service = FakeMyMapsSyncService()
    monkeypatch.setattr("src.main.mymaps_sync_service", fake_service)

    imported = asyncio.run(run_startup_only_mymaps_import())

    assert imported is False
    assert fake_service.calls == 0


def test_startup_only_import_does_not_write_marker_on_failure(tmp_path, monkeypatch) -> None:
    marker_path = tmp_path / "mymaps_import_startup.done"

    monkeypatch.setattr(settings, "tile_history_db_path", str(tmp_path / "tile_history.db"))
    monkeypatch.setattr(settings, "mymaps_import_startup_marker_name", marker_path.name)

    fake_service = FakeMyMapsSyncService(should_fail=True)
    monkeypatch.setattr("src.main.mymaps_sync_service", fake_service)

    imported = asyncio.run(run_startup_only_mymaps_import())

    assert imported is False
    assert fake_service.calls == 1
    assert not marker_path.exists()
