from datetime import UTC, datetime

from src.services.leaderboard_store import LeaderboardStore
from src.services.models import TileLocation


class _DummyHistoryStore:
    def __init__(self) -> None:
        self.get_history_calls = 0

    def get_all_tile_identifiers(self):
        return [("device_tracker.tile_1", "Tile 1")]

    def get_history(self, tile_uuid: str, limit=None):
        _ = tile_uuid
        _ = limit
        self.get_history_calls += 1
        return [
            TileLocation(
                tile_uuid="device_tracker.tile_1",
                latitude=38.0,
                longitude=-81.0,
                observed_at=datetime(2026, 8, 4, 12, 0, tzinfo=UTC),
                label="Tile 1",
            ),
            TileLocation(
                tile_uuid="device_tracker.tile_1",
                latitude=38.0005,
                longitude=-81.0005,
                observed_at=datetime(2026, 8, 4, 12, 5, tzinfo=UTC),
                label="Tile 1",
            ),
        ]


class _DummyAreaStore:
    def get_areas(self, tile_uuid: str):
        _ = tile_uuid
        return []


def _leaderboard_store() -> LeaderboardStore:
    return LeaderboardStore(
        history_store=_DummyHistoryStore(),
        area_store=_DummyAreaStore(),
        cache_ttl_seconds=60,
    )


def test_subcamp_c1_is_classified_as_camp_area() -> None:
    store = _leaderboard_store()
    assert store._is_camp_area("subcamp c1")
    assert store._is_camp_area("Subcamp C1".strip().lower())


def test_other_camp_names_are_not_classified_as_camp_area() -> None:
    store = _leaderboard_store()
    assert not store._is_camp_area("base camp alpha")
    assert not store._is_camp_area("subcamp c2")


def test_unrelated_area_is_not_classified_as_camp_area() -> None:
    store = _leaderboard_store()
    assert not store._is_camp_area("action point village")


def test_leaderboard_cache_reuses_recent_result() -> None:
    history_store = _DummyHistoryStore()
    store = LeaderboardStore(
        history_store=history_store,
        area_store=_DummyAreaStore(),
        cache_ttl_seconds=60,
    )

    first = store.get_leaderboard()
    second = store.get_leaderboard()

    assert history_store.get_history_calls == 1
    assert first.distance[0].tile_uuid == "device_tracker.tile_1"
    assert second.distance[0].tile_uuid == "device_tracker.tile_1"


def test_leaderboard_cache_invalidation_forces_recompute() -> None:
    history_store = _DummyHistoryStore()
    store = LeaderboardStore(
        history_store=history_store,
        area_store=_DummyAreaStore(),
        cache_ttl_seconds=60,
    )

    store.get_leaderboard()
    store.invalidate_cache()
    store.get_leaderboard()

    assert history_store.get_history_calls == 2
