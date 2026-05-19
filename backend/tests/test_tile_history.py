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
