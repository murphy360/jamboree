from datetime import UTC, datetime

from fastapi.testclient import TestClient

from src.main import app
from src.services.history_store import TileHistoryStore
from src.services.models import TileLocation


def build_history_store(tmp_path, name: str) -> TileHistoryStore:
    return TileHistoryStore(db_path=str(tmp_path / name))


def test_tile_history_endpoint_returns_recorded_positions(tmp_path) -> None:
    original_store = getattr(app.state, "history_store", None)
    history_store = build_history_store(tmp_path, "endpoint.db")
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


def test_get_latest_locations_returns_latest_point_per_tile(tmp_path) -> None:
    history_store = build_history_store(tmp_path, "latest.db")
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


def test_get_latest_locations_prefers_latest_polled_at(tmp_path) -> None:
    history_store = build_history_store(tmp_path, "polled.db")
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


def test_record_keeps_only_first_and_last_stationary_breadcrumb(tmp_path) -> None:
    history_store = build_history_store(tmp_path, "stationary.db")
    history_store.record(
        [
            TileLocation(
                tile_uuid="device_tracker.tile_d",
                latitude=38.4,
                longitude=-81.4,
                observed_at=datetime(2026, 5, 19, 15, 0, tzinfo=UTC),
                label="Tile D",
            ),
            TileLocation(
                tile_uuid="device_tracker.tile_d",
                latitude=38.4,
                longitude=-81.4,
                observed_at=datetime(2026, 5, 19, 15, 5, tzinfo=UTC),
                label="Tile D",
            ),
            TileLocation(
                tile_uuid="device_tracker.tile_d",
                latitude=38.4,
                longitude=-81.4,
                observed_at=datetime(2026, 5, 19, 15, 10, tzinfo=UTC),
                label="Tile D",
            ),
        ]
    )

    history = history_store.get_history("device_tracker.tile_d")

    assert len(history) == 2
    assert history[0].observed_at.isoformat() == "2026-05-19T15:00:00+00:00"
    assert history[1].observed_at.isoformat() == "2026-05-19T15:10:00+00:00"


def test_record_keeps_departure_point_before_location_changes(tmp_path) -> None:
    history_store = build_history_store(tmp_path, "departure.db")
    history_store.record(
        [
            TileLocation(
                tile_uuid="device_tracker.tile_e",
                latitude=38.5,
                longitude=-81.5,
                observed_at=datetime(2026, 5, 19, 16, 0, tzinfo=UTC),
                label="Tile E",
            ),
            TileLocation(
                tile_uuid="device_tracker.tile_e",
                latitude=38.5,
                longitude=-81.5,
                observed_at=datetime(2026, 5, 19, 16, 5, tzinfo=UTC),
                label="Tile E",
            ),
            TileLocation(
                tile_uuid="device_tracker.tile_e",
                latitude=38.6,
                longitude=-81.6,
                observed_at=datetime(2026, 5, 19, 16, 10, tzinfo=UTC),
                label="Tile E",
            ),
        ]
    )

    history = history_store.get_history("device_tracker.tile_e")

    assert len(history) == 3
    assert history[0].latitude == 38.5
    assert history[1].latitude == 38.5
    assert history[2].latitude == 38.6


def test_tile_history_persists_across_store_reopen(tmp_path) -> None:
    db_path = tmp_path / "tile_history.db"
    first_store = TileHistoryStore(db_path=str(db_path))
    first_store.record(
        [
            TileLocation(
                tile_uuid="device_tracker.tile_f",
                latitude=38.7,
                longitude=-81.7,
                observed_at=datetime(2026, 5, 19, 17, 0, tzinfo=UTC),
                label="Tile F",
            )
        ]
    )
    first_store.close()

    reopened_store = TileHistoryStore(db_path=str(db_path))
    history = reopened_store.get_history("device_tracker.tile_f")

    assert len(history) == 1
    assert history[0].label == "Tile F"
    assert history[0].latitude == 38.7
