from datetime import UTC, datetime

from fastapi.testclient import TestClient

from src.main import app
from src.services.history_store import TileHistoryStore
from src.services.models import TileLocation


def test_tile_history_endpoint_returns_recorded_positions() -> None:
    original_store = getattr(app.state, "history_store", None)
    history_store = TileHistoryStore()
    history_store.record(
        [
            TileLocation(
                tile_uuid="device_tracker.tile_abc",
                latitude=38.1,
                longitude=-81.2,
                observed_at=datetime(2026, 5, 18, 12, 0, tzinfo=UTC),
                label="Tile ABC",
            ),
            TileLocation(
                tile_uuid="device_tracker.tile_abc",
                latitude=38.2,
                longitude=-81.3,
                observed_at=datetime(2026, 5, 18, 12, 5, tzinfo=UTC),
                label="Tile ABC",
            ),
        ]
    )
    app.state.history_store = history_store

    try:
        client = TestClient(app)
        response = client.get("/tiles/device_tracker.tile_abc/history")

        assert response.status_code == 200
        payload = response.json()
        assert payload["tile_uuid"] == "device_tracker.tile_abc"
        assert payload["label"] == "Tile ABC"
        assert len(payload["items"]) == 2
        assert payload["items"][0]["latitude"] == 38.1
        assert payload["items"][1]["longitude"] == -81.3
    finally:
        app.state.history_store = original_store


def test_get_latest_locations_returns_latest_point_per_tile() -> None:
    history_store = TileHistoryStore()
    history_store.record(
        [
            TileLocation(
                tile_uuid="device_tracker.tile_a",
                latitude=38.1,
                longitude=-81.1,
                observed_at=datetime(2026, 5, 18, 12, 0, tzinfo=UTC),
                label="Tile A",
            ),
            TileLocation(
                tile_uuid="device_tracker.tile_a",
                latitude=38.2,
                longitude=-81.2,
                observed_at=datetime(2026, 5, 18, 12, 10, tzinfo=UTC),
                label="Tile A",
            ),
            TileLocation(
                tile_uuid="device_tracker.tile_b",
                latitude=39.1,
                longitude=-82.1,
                observed_at=datetime(2026, 5, 18, 12, 5, tzinfo=UTC),
                label="Tile B",
            ),
        ]
    )

    latest = history_store.get_latest_locations()
    by_uuid = {item.tile_uuid: item for item in latest}

    assert len(latest) == 2
    assert by_uuid["device_tracker.tile_a"].latitude == 38.2
    assert by_uuid["device_tracker.tile_a"].longitude == -81.2
    assert by_uuid["device_tracker.tile_b"].latitude == 39.1


def test_get_latest_locations_prefers_latest_polled_at() -> None:
    history_store = TileHistoryStore()
    history_store.record(
        [
            TileLocation(
                tile_uuid="device_tracker.tile_c",
                latitude=38.0,
                longitude=-81.0,
                observed_at=datetime(2026, 5, 19, 13, 0, tzinfo=UTC),
                polled_at=datetime(2026, 5, 19, 13, 0, tzinfo=UTC),
                label="Tile C",
            ),
            TileLocation(
                tile_uuid="device_tracker.tile_c",
                latitude=38.3,
                longitude=-81.3,
                observed_at=datetime(2026, 5, 19, 12, 0, tzinfo=UTC),
                polled_at=datetime(2026, 5, 19, 14, 0, tzinfo=UTC),
                label="Tile C",
            ),
        ]
    )

    latest = history_store.get_latest_locations()

    assert len(latest) == 1
    assert latest[0].tile_uuid == "device_tracker.tile_c"
    assert latest[0].latitude == 38.3
    assert latest[0].longitude == -81.3
    assert latest[0].polled_at is not None
    assert latest[0].polled_at.isoformat() == "2026-05-19T14:00:00+00:00"
