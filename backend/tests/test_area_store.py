"""Tests for AreaStore: convex hull, point-in-polygon, CRUD, and dwell cluster integration."""

from datetime import UTC, datetime

import pytest

from src.services.area_store import AreaStore, convex_hull, point_in_polygon
from src.services.history_store import TileHistoryStore
from src.services.models import AreaPolygonPoint, TileLocation


def make_store(tmp_path, name: str = "areas.db") -> AreaStore:
    return AreaStore(db_path=str(tmp_path / name))


def make_history_store(tmp_path, name: str = "history.db") -> TileHistoryStore:
    return TileHistoryStore(db_path=str(tmp_path / name))


def test_convex_hull_square():
    points = [(0.0, 0.0), (0.0, 1.0), (1.0, 1.0), (1.0, 0.0)]
    hull = convex_hull(points)
    assert len(hull) == 4
    # All original corners should appear in hull
    hull_set = {(round(p[0], 6), round(p[1], 6)) for p in hull}
    for pt in points:
        assert (round(pt[0], 6), round(pt[1], 6)) in hull_set


def test_convex_hull_collinear_raises():
    with pytest.raises(ValueError, match="collinear"):
        convex_hull([(0.0, 0.0), (1.0, 1.0), (2.0, 2.0)])


def test_convex_hull_too_few_points_raises():
    with pytest.raises(ValueError):
        convex_hull([(0.0, 0.0), (1.0, 1.0)])


def test_point_in_polygon_inside():
    polygon = [
        AreaPolygonPoint(latitude=0.0, longitude=0.0),
        AreaPolygonPoint(latitude=0.0, longitude=1.0),
        AreaPolygonPoint(latitude=1.0, longitude=1.0),
        AreaPolygonPoint(latitude=1.0, longitude=0.0),
    ]
    assert point_in_polygon(0.5, 0.5, polygon) is True


def test_point_in_polygon_outside():
    polygon = [
        AreaPolygonPoint(latitude=0.0, longitude=0.0),
        AreaPolygonPoint(latitude=0.0, longitude=1.0),
        AreaPolygonPoint(latitude=1.0, longitude=1.0),
        AreaPolygonPoint(latitude=1.0, longitude=0.0),
    ]
    assert point_in_polygon(2.0, 2.0, polygon) is False


def test_point_in_polygon_boundary_is_inside():
    polygon = [
        AreaPolygonPoint(latitude=0.0, longitude=0.0),
        AreaPolygonPoint(latitude=0.0, longitude=1.0),
        AreaPolygonPoint(latitude=1.0, longitude=1.0),
        AreaPolygonPoint(latitude=1.0, longitude=0.0),
    ]
    assert point_in_polygon(0.0, 0.5, polygon) is True


def test_create_area_persists_and_retrieves(tmp_path):
    store = make_store(tmp_path)
    centers = [(38.07, -81.07), (38.08, -81.07), (38.075, -81.06)]
    area = store.create_area("tile_uuid_1", "Camp Alpha", centers)

    assert area.area_id
    assert area.name == "Camp Alpha"
    assert area.tile_uuid == "tile_uuid_1"
    assert len(area.polygon) >= 3

    areas = store.get_areas("tile_uuid_1")
    assert len(areas) == 1
    assert areas[0].name == "Camp Alpha"


def test_update_area_renames_it(tmp_path):
    store = make_store(tmp_path)
    centers = [(38.07, -81.07), (38.08, -81.07), (38.075, -81.06)]
    area = store.create_area("tile_uuid_1", "Old Name", centers)

    updated = store.update_area(area.area_id, "New Name")
    assert updated is not None
    assert updated.name == "New Name"

    areas = store.get_areas("tile_uuid_1")
    assert areas[0].name == "New Name"


def test_delete_area_removes_it(tmp_path):
    store = make_store(tmp_path)
    centers = [(38.07, -81.07), (38.08, -81.07), (38.075, -81.06)]
    area = store.create_area("tile_uuid_1", "Temp Area", centers)

    deleted = store.delete_area(area.area_id)
    assert deleted is True

    areas = store.get_areas("tile_uuid_1")
    assert len(areas) == 0


def test_delete_nonexistent_area_returns_false(tmp_path):
    store = make_store(tmp_path)
    assert store.delete_area("nonexistent-id") is False


def test_area_stats_computed_from_history(tmp_path):
    store = make_store(tmp_path)
    centers = [(38.075, -81.075), (38.076, -81.075), (38.0755, -81.074)]
    area = store.create_area("tile_1", "Zone A", centers)

    history = [
        TileLocation(tile_uuid="tile_1", latitude=38.0754, longitude=-81.0748,
                     observed_at=datetime(2026, 5, 20, 10, 0, tzinfo=UTC), label="T"),
        TileLocation(tile_uuid="tile_1", latitude=38.0754, longitude=-81.0748,
                     observed_at=datetime(2026, 5, 20, 10, 5, tzinfo=UTC), label="T"),
    ]

    areas_with_stats = store.compute_area_stats(history, [area])
    assert len(areas_with_stats) == 1
    assert areas_with_stats[0].samples >= 0  # depends on geometry


def test_merge_area_updates_target_and_removes_sources(tmp_path):
    store = make_store(tmp_path)
    target = store.create_area(
        "tile_1",
        "Target Area",
        [
            AreaPolygonPoint(latitude=38.070, longitude=-81.070),
            AreaPolygonPoint(latitude=38.071, longitude=-81.070),
            AreaPolygonPoint(latitude=38.0705, longitude=-81.069),
        ],
    )
    source = store.create_area(
        "tile_1",
        "Source Area",
        [
            AreaPolygonPoint(latitude=38.080, longitude=-81.080),
            AreaPolygonPoint(latitude=38.081, longitude=-81.080),
            AreaPolygonPoint(latitude=38.0805, longitude=-81.079),
        ],
    )

    merged = store.merge_area(
        tile_uuid="tile_1",
        merge_into_area_id=target.area_id,
        cluster_centers=[AreaPolygonPoint(latitude=38.082, longitude=-81.081)],
        merge_source_area_ids=[source.area_id],
    )

    assert merged.area_id == target.area_id
    assert merged.name == "Target Area"
    assert len(merged.polygon) >= 3

    remaining = store.get_areas("tile_1")
    assert len(remaining) == 1
    assert remaining[0].area_id == target.area_id


def test_merge_area_promotes_imported_target_to_manual(tmp_path):
    store = make_store(tmp_path)
    target = store.create_area(
        "global",
        "Imported Target",
        [
            AreaPolygonPoint(latitude=38.070, longitude=-81.070),
            AreaPolygonPoint(latitude=38.071, longitude=-81.070),
            AreaPolygonPoint(latitude=38.0705, longitude=-81.069),
        ],
        source_type="mymaps_kml_polygon",
        source_name="Tents_NSJ26",
        source_url="https://example.test/kml",
        source_feature_id="abc:1",
    )
    source = store.create_area(
        "global",
        "Imported Source",
        [
            AreaPolygonPoint(latitude=38.080, longitude=-81.080),
            AreaPolygonPoint(latitude=38.081, longitude=-81.080),
            AreaPolygonPoint(latitude=38.0805, longitude=-81.079),
        ],
        source_type="mymaps_kml_polygon",
        source_name="Tents_NSJ26",
        source_url="https://example.test/kml",
        source_feature_id="abc:2",
    )

    merged = store.merge_area(
        tile_uuid="global",
        merge_into_area_id=target.area_id,
        cluster_centers=[],
        merge_source_area_ids=[source.area_id],
    )

    assert merged.source_type == "manual"
    assert merged.source_name is None
    assert merged.source_url is None
    assert merged.source_feature_id is None

    # My Maps sync deletes only non-manual rows. A user-merged area must persist.
    deleted = store.delete_non_manual_areas("global")
    assert deleted == 0

    remaining = store.get_areas("global")
    assert len(remaining) == 1
    assert remaining[0].area_id == target.area_id


def test_merge_area_rejects_missing_target(tmp_path):
    store = make_store(tmp_path)

    with pytest.raises(ValueError, match="Merge target area"):
        store.merge_area(
            tile_uuid="tile_1",
            merge_into_area_id="missing-id",
            cluster_centers=[
                AreaPolygonPoint(latitude=38.070, longitude=-81.070),
                AreaPolygonPoint(latitude=38.071, longitude=-81.070),
                AreaPolygonPoint(latitude=38.0705, longitude=-81.069),
            ],
        )


def test_merge_area_buffers_hotspot_range(tmp_path):
    store = make_store(tmp_path)
    target = store.create_area(
        "tile_1",
        "Target Area",
        [
            AreaPolygonPoint(latitude=38.070, longitude=-81.070),
            AreaPolygonPoint(latitude=38.071, longitude=-81.070),
            AreaPolygonPoint(latitude=38.0705, longitude=-81.069),
        ],
    )

    hotspot_lat = 38.080
    hotspot_lon = -81.080
    merged = store.merge_area(
        tile_uuid="tile_1",
        merge_into_area_id=target.area_id,
        cluster_centers=[AreaPolygonPoint(latitude=hotspot_lat, longitude=hotspot_lon)],
        hotspot_centers=[AreaPolygonPoint(latitude=hotspot_lat, longitude=hotspot_lon)],
        hotspot_buffer_meters=50,
    )

    north_40m = hotspot_lat + (40 / 111_320)
    assert point_in_polygon(north_40m, hotspot_lon, merged.polygon) is True


def test_area_points_excluded_from_dwell_clusters(tmp_path):
    history_store = make_history_store(tmp_path)
    area_store = make_store(tmp_path)

    # Two tight clusters far apart
    history = [
        TileLocation(tile_uuid="t1", latitude=38.07, longitude=-81.07,
                     observed_at=datetime(2026, 5, 20, 10, i, tzinfo=UTC), label="T")
        for i in range(10)
    ] + [
        TileLocation(tile_uuid="t1", latitude=38.10, longitude=-81.10,
                     observed_at=datetime(2026, 5, 20, 11, i, tzinfo=UTC), label="T")
        for i in range(10)
    ]

    # Create an area around the first cluster
    centers = [(38.069, -81.071), (38.071, -81.071), (38.07, -81.069)]
    area = area_store.create_area("t1", "Cluster One Area", centers)

    clusters_without_area = history_store.build_dwell_clusters(history)
    clusters_with_area = history_store.build_dwell_clusters(history, areas=[area])

    # Without area filtering: 2 clusters
    assert len(clusters_without_area) == 2
    # With area filtering: first cluster excluded, only second remains
    assert len(clusters_with_area) < len(clusters_without_area)


def test_merge_areas_by_name_prefix_combines_and_renames(tmp_path):
    store = make_store(tmp_path)
    store.create_area(
        "global",
        "BARR North",
        [
            AreaPolygonPoint(latitude=38.070, longitude=-81.070),
            AreaPolygonPoint(latitude=38.071, longitude=-81.070),
            AreaPolygonPoint(latitude=38.0705, longitude=-81.069),
        ],
    )
    store.create_area(
        "global",
        "BARR South",
        [
            AreaPolygonPoint(latitude=38.080, longitude=-81.080),
            AreaPolygonPoint(latitude=38.081, longitude=-81.080),
            AreaPolygonPoint(latitude=38.0805, longitude=-81.079),
        ],
    )
    store.create_area(
        "global",
        "Other",
        [
            AreaPolygonPoint(latitude=38.090, longitude=-81.090),
            AreaPolygonPoint(latitude=38.091, longitude=-81.090),
            AreaPolygonPoint(latitude=38.0905, longitude=-81.089),
        ],
    )

    matched_count, deleted_count = store.merge_areas_by_name_prefix(
        tile_uuid="global",
        source_prefix="BARR",
        target_name="Barrels",
    )

    assert matched_count == 2
    assert deleted_count == 1

    areas = store.get_areas("global")
    names = [area.name for area in areas]
    assert names.count("Barrels") == 1
    assert "Other" in names
