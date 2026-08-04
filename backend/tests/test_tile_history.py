from datetime import UTC, datetime

from fastapi.testclient import TestClient

from src.main import app
from src.services.area_store import AreaStore
from src.services.history_store import TileHistoryStore
from src.services.leaderboard_store import LeaderboardStore
from src.services.models import AreaPolygonPoint, TileLocation


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


def test_tile_details_endpoint_returns_breakdowns(tmp_path) -> None:
    original_store = getattr(app.state, "history_store", None)
    history_store = build_history_store(tmp_path, "details.db")
    history_store.record(
        [
            TileLocation(
                tile_uuid="device_tracker.tile_details",
                latitude=38.1,
                longitude=-81.2,
                observed_at=datetime(2026, 5, 18, 12, 0, tzinfo=UTC),
                label="Tile Details",
            ),
            TileLocation(
                tile_uuid="device_tracker.tile_details",
                latitude=38.1,
                longitude=-81.2,
                observed_at=datetime(2026, 5, 18, 13, 0, tzinfo=UTC),
                label="Tile Details",
            ),
            TileLocation(
                tile_uuid="device_tracker.tile_details",
                latitude=38.2,
                longitude=-81.3,
                observed_at=datetime(2026, 5, 19, 9, 30, tzinfo=UTC),
                label="Tile Details",
            ),
        ]
    )
    app.state.history_store = history_store

    try:
        client = TestClient(app)
        response = client.get("/tiles/device_tracker.tile_details/details")

        assert response.status_code == 200
        payload = response.json()
        assert payload["tile_uuid"] == "device_tracker.tile_details"
        assert payload["total_points"] == 3
        assert len(payload["daily_breakdown"]) == 2
        assert payload["daily_breakdown"][0]["date"] == "2026-05-18"
        assert len(payload["dwell_clusters"]) >= 1
    finally:
        app.state.history_store = original_store


def test_tile_details_dwell_merge_radius_query_param_changes_cluster_count(tmp_path) -> None:
    original_store = getattr(app.state, "history_store", None)
    history_store = build_history_store(tmp_path, "merge-radius.db")
    history_store.record(
        [
            TileLocation(
                tile_uuid="device_tracker.tile_merge",
                latitude=38.1000,
                longitude=-81.2000,
                observed_at=datetime(2026, 5, 20, 8, 0, tzinfo=UTC),
                label="Tile Merge",
            ),
            TileLocation(
                tile_uuid="device_tracker.tile_merge",
                latitude=38.1000,
                longitude=-81.2000,
                observed_at=datetime(2026, 5, 20, 8, 20, tzinfo=UTC),
                label="Tile Merge",
            ),
            TileLocation(
                tile_uuid="device_tracker.tile_merge",
                latitude=38.1006,
                longitude=-81.2000,
                observed_at=datetime(2026, 5, 20, 8, 21, tzinfo=UTC),
                label="Tile Merge",
            ),
            TileLocation(
                tile_uuid="device_tracker.tile_merge",
                latitude=38.1006,
                longitude=-81.2000,
                observed_at=datetime(2026, 5, 20, 8, 30, tzinfo=UTC),
                label="Tile Merge",
            ),
        ]
    )
    app.state.history_store = history_store

    try:
        client = TestClient(app)
        split_response = client.get("/tiles/device_tracker.tile_merge/details?dwell_merge_meters=50")
        merged_response = client.get("/tiles/device_tracker.tile_merge/details?dwell_merge_meters=100")

        assert split_response.status_code == 200
        assert merged_response.status_code == 200

        split_clusters = split_response.json()["dwell_clusters"]
        merged_clusters = merged_response.json()["dwell_clusters"]

        assert len(split_clusters) == 2
        assert len(merged_clusters) == 1
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



def test_delete_tile_endpoint_removes_history_and_custom_areas(tmp_path) -> None:
    original_history_store = getattr(app.state, "history_store", None)
    original_area_store = getattr(app.state, "area_store", None)

    db_path = tmp_path / "delete-tile.db"
    history_store = TileHistoryStore(db_path=str(db_path))
    area_store = AreaStore(db_path=str(db_path))

    tile_uuid = "device_tracker.tile_delete"
    history_store.record(
        [
            TileLocation(
                tile_uuid=tile_uuid,
                latitude=38.1,
                longitude=-81.2,
                observed_at=datetime(2026, 5, 21, 12, 0, tzinfo=UTC),
                label="Tile Delete",
            ),
            TileLocation(
                tile_uuid=tile_uuid,
                latitude=38.2,
                longitude=-81.3,
                observed_at=datetime(2026, 5, 21, 12, 5, tzinfo=UTC),
                label="Tile Delete",
            ),
        ]
    )
    area_store.create_area(
        tile_uuid,
        "Delete Me",
        [
            AreaPolygonPoint(latitude=38.1000, longitude=-81.2000),
            AreaPolygonPoint(latitude=38.1010, longitude=-81.2000),
            AreaPolygonPoint(latitude=38.1005, longitude=-81.1990),
        ],
    )

    app.state.history_store = history_store
    app.state.area_store = area_store

    try:
        client = TestClient(app)
        response = client.delete(f"/tiles/{tile_uuid}")

        assert response.status_code == 204
        assert history_store.get_history(tile_uuid) == []
        assert area_store.get_areas(tile_uuid) == []
    finally:
        app.state.history_store = original_history_store
        app.state.area_store = original_area_store

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


def test_record_keeps_all_points_when_max_is_zero(tmp_path) -> None:
    history_store = TileHistoryStore(db_path=str(tmp_path / "unlimited.db"), max_points_per_tile=0)
    history_store.record(
        [
            TileLocation(
                tile_uuid="device_tracker.tile_unlimited",
                latitude=38.0 + (index * 0.001),
                longitude=-81.0 - (index * 0.001),
                observed_at=datetime(2026, 5, 20, 10, index, tzinfo=UTC),
                label="Tile Unlimited",
            )
            for index in range(20)
        ]
    )

    history = history_store.get_history("device_tracker.tile_unlimited")
    assert len(history) == 20


def test_build_dwell_clusters_merges_near_points_within_default_50m(tmp_path) -> None:
    history_store = build_history_store(tmp_path, "distance-clusters.db")
    history = [
        TileLocation(
            tile_uuid="device_tracker.tile_clusters",
            latitude=38.2000,
            longitude=-81.1000,
            observed_at=datetime(2026, 5, 20, 9, 0, tzinfo=UTC),
            label="Tile Clusters",
        ),
        TileLocation(
            tile_uuid="device_tracker.tile_clusters",
            latitude=38.2003,
            longitude=-81.1000,
            observed_at=datetime(2026, 5, 20, 9, 10, tzinfo=UTC),
            label="Tile Clusters",
        ),
        TileLocation(
            tile_uuid="device_tracker.tile_clusters",
            latitude=38.2012,
            longitude=-81.1000,
            observed_at=datetime(2026, 5, 20, 9, 20, tzinfo=UTC),
            label="Tile Clusters",
        ),
    ]

    clusters_default = history_store.build_dwell_clusters(history)
    clusters_wide = history_store.build_dwell_clusters(history, merge_radius_meters=200)

    assert len(clusters_default) == 2
    assert len(clusters_wide) == 1


def test_tile_history_endpoint_applies_limit_and_reports_truncation(tmp_path) -> None:
    original_store = getattr(app.state, "history_store", None)
    history_store = build_history_store(tmp_path, "limit-history.db")
    history_store.record(
        [
            TileLocation(
                tile_uuid="device_tracker.tile_limit",
                latitude=38.0 + (index * 0.001),
                longitude=-81.0 - (index * 0.001),
                observed_at=datetime(2026, 5, 22, 10, index, tzinfo=UTC),
                label="Tile Limit",
            )
            for index in range(5)
        ]
    )
    app.state.history_store = history_store

    try:
        client = TestClient(app)
        response = client.get("/tiles/device_tracker.tile_limit/history?limit=2")

        assert response.status_code == 200
        payload = response.json()
        assert payload["total_points"] == 5
        assert payload["returned_points"] == 2
        assert payload["history_truncated"] is True
        assert payload["items"][0]["observed_at"] == "2026-05-22T10:03:00Z"
        assert payload["items"][1]["observed_at"] == "2026-05-22T10:04:00Z"
    finally:
        app.state.history_store = original_store


def test_tile_details_endpoint_applies_history_limit_and_reports_truncation(tmp_path) -> None:
    original_store = getattr(app.state, "history_store", None)
    history_store = build_history_store(tmp_path, "limit-details.db")
    history_store.record(
        [
            TileLocation(
                tile_uuid="device_tracker.tile_limit_details",
                latitude=38.2 + (index * 0.0001),
                longitude=-81.2 - (index * 0.0001),
                observed_at=datetime(2026, 5, 23, 9, index, tzinfo=UTC),
                label="Tile Limit Details",
            )
            for index in range(6)
        ]
    )
    app.state.history_store = history_store

    try:
        client = TestClient(app)
        response = client.get(
            "/tiles/device_tracker.tile_limit_details/details?history_limit=3"
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["total_points"] == 6
        assert payload["returned_points"] == 3
        assert payload["history_truncated"] is True
        assert payload["first_observed_at"] == "2026-05-23T09:00:00Z"
        assert payload["last_observed_at"] == "2026-05-23T09:05:00Z"
        assert len(payload["items"]) == 3
        assert payload["items"][0]["observed_at"] == "2026-05-23T09:03:00Z"
    finally:
        app.state.history_store = original_store


def test_top_areas_endpoint_returns_historical_minutes_ranked(tmp_path) -> None:
    original_history_store = getattr(app.state, "history_store", None)
    original_area_store = getattr(app.state, "area_store", None)
    original_leaderboard_store = getattr(app.state, "leaderboard_store", None)

    db_path = tmp_path / "top-areas.db"
    history_store = TileHistoryStore(db_path=str(db_path))
    area_store = AreaStore(db_path=str(db_path))
    leaderboard_store = LeaderboardStore(
        history_store=history_store,
        area_store=area_store,
        cache_ttl_seconds=0,
    )

    area_store.create_area(
        "global",
        "Action Alley",
        [
            AreaPolygonPoint(latitude=38.1000, longitude=-81.2000),
            AreaPolygonPoint(latitude=38.1000, longitude=-81.1900),
            AreaPolygonPoint(latitude=38.1100, longitude=-81.1900),
            AreaPolygonPoint(latitude=38.1100, longitude=-81.2000),
        ],
    )
    area_store.create_area(
        "global",
        "Patch Zone",
        [
            AreaPolygonPoint(latitude=38.2000, longitude=-81.3000),
            AreaPolygonPoint(latitude=38.2000, longitude=-81.2900),
            AreaPolygonPoint(latitude=38.2100, longitude=-81.2900),
            AreaPolygonPoint(latitude=38.2100, longitude=-81.3000),
        ],
    )

    history_store.record(
        [
            TileLocation(
                tile_uuid="device_tracker.tile_1",
                latitude=38.1050,
                longitude=-81.1950,
                observed_at=datetime(2026, 7, 24, 12, 0, tzinfo=UTC),
                label="Tile 1",
            ),
            TileLocation(
                tile_uuid="device_tracker.tile_1",
                latitude=38.1050,
                longitude=-81.1950,
                observed_at=datetime(2026, 7, 24, 12, 30, tzinfo=UTC),
                label="Tile 1",
            ),
            TileLocation(
                tile_uuid="device_tracker.tile_2",
                latitude=38.1055,
                longitude=-81.1940,
                observed_at=datetime(2026, 7, 24, 13, 0, tzinfo=UTC),
                label="Tile 2",
            ),
            TileLocation(
                tile_uuid="device_tracker.tile_2",
                latitude=38.1055,
                longitude=-81.1940,
                observed_at=datetime(2026, 7, 24, 13, 20, tzinfo=UTC),
                label="Tile 2",
            ),
            TileLocation(
                tile_uuid="device_tracker.tile_3",
                latitude=38.2050,
                longitude=-81.2950,
                observed_at=datetime(2026, 7, 24, 14, 0, tzinfo=UTC),
                label="Tile 3",
            ),
            TileLocation(
                tile_uuid="device_tracker.tile_3",
                latitude=38.2050,
                longitude=-81.2950,
                observed_at=datetime(2026, 7, 24, 14, 10, tzinfo=UTC),
                label="Tile 3",
            ),
        ]
    )

    app.state.history_store = history_store
    app.state.area_store = area_store
    app.state.leaderboard_store = leaderboard_store

    try:
        client = TestClient(app)
        response = client.get("/areas/top")

        assert response.status_code == 200
        payload = response.json()
        assert payload["area_tile_uuid"] == "global"
        assert len(payload["items"]) == 2

        first = payload["items"][0]
        assert first["rank"] == 1
        assert first["area_name"] == "Action Alley"
        assert first["minutes_spent"] == 50
        assert first["tiles_count"] == 2

        second = payload["items"][1]
        assert second["rank"] == 2
        assert second["area_name"] == "Patch Zone"
        assert second["minutes_spent"] == 10
        assert second["tiles_count"] == 1
    finally:
        app.state.history_store = original_history_store
        app.state.area_store = original_area_store
        app.state.leaderboard_store = original_leaderboard_store
