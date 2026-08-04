from pathlib import Path

from src.services.area_store import AreaStore
from src.services.models import AreaPolygonPoint
from src.tools.merge_barr_polygons import merge_barr_polygons


def _create_triangle(store: AreaStore, tile_uuid: str, name: str, lat_base: float) -> None:
    store.create_area(
        tile_uuid,
        name,
        [
            AreaPolygonPoint(latitude=lat_base, longitude=-81.0),
            AreaPolygonPoint(latitude=lat_base + 0.001, longitude=-81.0),
            AreaPolygonPoint(latitude=lat_base + 0.0005, longitude=-80.999),
        ],
    )


def test_merge_barr_polygons_combines_barr_areas(tmp_path) -> None:
    db_path = tmp_path / "areas.db"
    store = AreaStore(str(db_path))

    _create_triangle(store, "global", "BARR North", 38.0)
    _create_triangle(store, "global", "BARR South", 38.01)
    _create_triangle(store, "global", "Campsite", 38.02)

    stats = merge_barr_polygons(Path(db_path))

    assert stats.matched_areas == 2
    assert stats.merged_groups == 1
    assert stats.deleted_areas == 1

    areas = store.get_areas("global")
    names = [area.name for area in areas]
    assert names.count("Barrels") == 1
    assert "Campsite" in names

    barrels = next(area for area in areas if area.name == "Barrels")
    assert len(barrels.polygon) >= 3

    store.close()


def test_merge_barr_polygons_scopes_by_tile_uuid(tmp_path) -> None:
    db_path = tmp_path / "areas.db"
    store = AreaStore(str(db_path))

    _create_triangle(store, "global", "BARR Main", 38.0)
    _create_triangle(store, "tile_2", "BARR Other", 38.01)

    stats = merge_barr_polygons(Path(db_path), tile_uuid="global")

    assert stats.matched_areas == 1
    assert stats.merged_groups == 1
    assert stats.deleted_areas == 0

    all_areas = store.get_areas("global")
    global_barrels = [a for a in all_areas if a.tile_uuid == "global" and a.name == "Barrels"]
    other_tile_barr = [a for a in all_areas if a.tile_uuid == "tile_2" and a.name.startswith("BARR")]

    assert len(global_barrels) == 1
    assert len(other_tile_barr) == 1

    store.close()
