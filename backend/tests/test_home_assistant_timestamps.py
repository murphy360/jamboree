from datetime import UTC, datetime

from src.services.home_assistant_client import HomeAssistantTileClient


def test_to_location_uses_tile_timestamp_when_available() -> None:
    client = HomeAssistantTileClient(base_url="http://ha.local", token="test")
    state = {
        "entity_id": "device_tracker.tile_alpha",
        "last_updated": "2026-05-29T15:30:00+00:00",
        "attributes": {
            "latitude": 38.1,
            "longitude": -81.2,
            "last_seen": "2026-05-29T14:00:00+00:00",
        },
    }

    location = client._to_location(state, "Tile Alpha")

    assert location is not None
    assert location.tile_service_observed_at is not None
    assert location.tile_service_observed_at.isoformat() == "2026-05-29T14:00:00+00:00"
    assert location.observed_at.isoformat() == "2026-05-29T14:00:00+00:00"
    assert location.polled_at is not None


def test_to_location_keeps_tile_timestamp_empty_when_missing() -> None:
    client = HomeAssistantTileClient(base_url="http://ha.local", token="test")
    state = {
        "entity_id": "device_tracker.tile_beta",
        "last_updated": "2026-05-29T15:30:00+00:00",
        "attributes": {
            "latitude": 38.2,
            "longitude": -81.3,
        },
    }

    location = client._to_location(state, "Tile Beta")

    assert location is not None
    assert location.tile_service_observed_at is None
    assert location.observed_at == datetime(2026, 5, 29, 15, 30, tzinfo=UTC)
    assert location.polled_at is not None
