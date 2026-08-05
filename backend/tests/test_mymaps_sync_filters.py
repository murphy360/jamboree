from __future__ import annotations

import asyncio

from src.services.mymaps_sync import MyMapsSyncService


class FakeAreaStore:
    def __init__(self) -> None:
        self.imported_names: list[str] = []
        self.deleted_non_manual_calls: list[str] = []
        self.merge_rules: list[tuple[str, str]] = []

    def delete_non_manual_areas(self, tile_uuid: str) -> int:
        self.deleted_non_manual_calls.append(tile_uuid)
        return 0

    def upsert_imported_area(self, tile_uuid, name, polygon, source):  # type: ignore[no-untyped-def]
        self.imported_names.append(name)

    def merge_areas_by_name_prefix(self, tile_uuid: str, source_prefix: str, target_name: str) -> tuple[int, int]:
        self.merge_rules.append((source_prefix, target_name))
        return (0, 0)


class FakeMapFeatureStore:
    def __init__(self) -> None:
        self.replaced_count = 0
        self.deleted_non_manual_calls: list[str] = []

    def delete_non_manual_features(self, tile_uuid: str) -> int:
        self.deleted_non_manual_calls.append(tile_uuid)
        return 0

    def replace_source_features(self, tile_uuid, source_type, source_url, features):  # type: ignore[no-untyped-def]
        self.replaced_count = len(features)
        return len(features)


class MyMapsSyncServiceHarness(MyMapsSyncService):
    def __init__(self, *args, payload: bytes, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self._payload = payload

    async def _fetch_kml(self) -> bytes:
        return self._payload


def test_sync_skips_polygon_prefixes(tmp_path) -> None:
    area_store = FakeAreaStore()
    feature_store = FakeMapFeatureStore()
    payload = b"""
    <kml xmlns=\"http://www.opengis.net/kml/2.2\">
      <Document>
        <Folder>
          <name>Test Folder</name>
          <Placemark>
            <name>AP-XX</name>
            <Polygon>
              <outerBoundaryIs>
                <LinearRing>
                  <coordinates>-81.0,38.0,0 -81.0,38.001,0 -80.999,38.0,0 -81.0,38.0,0</coordinates>
                </LinearRing>
              </outerBoundaryIs>
            </Polygon>
          </Placemark>
          <Placemark>
            <name>BC-OAA-18</name>
            <Polygon>
              <outerBoundaryIs>
                <LinearRing>
                  <coordinates>-81.01,38.01,0 -81.01,38.011,0 -81.009,38.01,0 -81.01,38.01,0</coordinates>
                </LinearRing>
              </outerBoundaryIs>
            </Polygon>
          </Placemark>
          <Placemark>
            <name>Cabin 1</name>
            <Polygon>
              <outerBoundaryIs>
                <LinearRing>
                  <coordinates>-81.02,38.02,0 -81.02,38.021,0 -81.019,38.02,0 -81.02,38.02,0</coordinates>
                </LinearRing>
              </outerBoundaryIs>
            </Polygon>
            <Point>
              <coordinates>-81.03,38.03,0</coordinates>
            </Point>
          </Placemark>
        </Folder>
      </Document>
    </kml>
    """

    service = MyMapsSyncServiceHarness(
        area_store=area_store,
        map_feature_store=feature_store,
        kml_url="https://example.test/kml",
        tile_uuid="global",
        interval_seconds=900,
        enabled=True,
        polygon_exclude_prefixes=["feature", "AP-", "BC-OAA-"],
        polygon_merge_rules=[],
        payload=payload,
    )

    result = asyncio.run(service.sync_once())

    assert result.polygons_imported == 1
    assert result.features_imported == 1
    assert area_store.imported_names == ["Cabin 1"]
    assert feature_store.replaced_count == 1