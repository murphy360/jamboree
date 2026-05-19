from datetime import UTC, datetime

from src.services.models import TileLocation


def test_tile_location_timestamps_are_normalized_to_utc() -> None:
    location = TileLocation(
        tile_uuid="device_tracker.tile_utc",
        latitude=38.1,
        longitude=-81.2,
        observed_at="2026-05-19T21:28:00-04:00",
        tile_service_observed_at="2026-05-19T18:28:00-07:00",
        polled_at=datetime(2026, 5, 20, 1, 28, tzinfo=UTC),
        label="Tile UTC",
    )

    assert location.observed_at.tzinfo == UTC
    assert location.tile_service_observed_at is not None
    assert location.tile_service_observed_at.tzinfo == UTC
    assert location.polled_at is not None
    assert location.polled_at.tzinfo == UTC
    assert location.observed_at.isoformat() == "2026-05-20T01:28:00+00:00"
    assert location.tile_service_observed_at.isoformat() == "2026-05-20T01:28:00+00:00"
