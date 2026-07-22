from src.services.leaderboard_store import LeaderboardStore


class _DummyHistoryStore:
    def get_all_tile_identifiers(self):
        return []


class _DummyAreaStore:
    pass


def _leaderboard_store() -> LeaderboardStore:
    return LeaderboardStore(history_store=_DummyHistoryStore(), area_store=_DummyAreaStore())


def test_subcamp_c1_is_classified_as_camp_area() -> None:
    store = _leaderboard_store()
    assert store._is_camp_area("subcamp c1")
    assert store._is_camp_area("Subcamp C1".lower())


def test_camp_keyword_is_still_classified_as_camp_area() -> None:
    store = _leaderboard_store()
    assert store._is_camp_area("base camp alpha")


def test_unrelated_area_is_not_classified_as_camp_area() -> None:
    store = _leaderboard_store()
    assert not store._is_camp_area("action point village")
