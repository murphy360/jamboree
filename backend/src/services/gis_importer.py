from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from src.services.area_store import AreaStore, ImportedAreaSource
from src.services.models import AreaPolygonPoint, CustomArea


@dataclass(frozen=True)
class GisImportResult:
    layer_name: str
    service_url: str
    tile_uuid: str
    imported: int
    updated: int
    skipped: int


class GisImporter:
    def __init__(self, area_store: AreaStore) -> None:
        self._area_store = area_store

    async def import_arcgis_layer(
        self,
        layer_name: str,
        service_url: str,
        tile_uuid: str = "global",
        layer_index: int = 0,
    ) -> GisImportResult:
        feature_url = self._build_feature_url(service_url, layer_index)
        features = await self._fetch_features(feature_url)

        imported = 0
        updated = 0
        skipped = 0
        for feature in features:
            polygon = self._feature_to_polygon(feature)
            if len(polygon) < 3:
                skipped += 1
                continue

            attributes = feature.get("attributes") or {}
            feature_id = self._feature_id(attributes)
            if not feature_id:
                skipped += 1
                continue

            name = self._feature_name(attributes) or layer_name
            source = ImportedAreaSource(
                source_type="gis",
                source_name=layer_name,
                source_url=feature_url,
                source_feature_id=feature_id,
            )
            existed = self._area_store.get_area_by_source(source)
            self._area_store.upsert_imported_area(
                tile_uuid=tile_uuid,
                name=name,
                polygon=polygon,
                source=source,
            )
            if existed:
                updated += 1
            else:
                imported += 1

        return GisImportResult(
            layer_name=layer_name,
            service_url=feature_url,
            tile_uuid=tile_uuid,
            imported=imported,
            updated=updated,
            skipped=skipped,
        )

    def _build_feature_url(self, service_url: str, layer_index: int) -> str:
        base_url = service_url.rstrip("/")
        if base_url.lower().endswith("/query"):
            return base_url[:-6]
        if base_url.lower().endswith("/featureserver") or base_url.lower().endswith("/mapserver"):
            return f"{base_url}/{layer_index}"
        return base_url

    async def _fetch_features(self, feature_layer_url: str) -> list[dict[str, Any]]:
        features: list[dict[str, Any]] = []
        offset = 0
        page_size = 2000

        async with httpx.AsyncClient(timeout=30) as client:
            while True:
                response = await client.get(
                    f"{feature_layer_url}/query",
                    params={
                        "where": "1=1",
                        "outFields": "*",
                        "returnGeometry": "true",
                        "outSR": "4326",
                        "f": "json",
                        "resultOffset": offset,
                        "resultRecordCount": page_size,
                    },
                )
                response.raise_for_status()
                payload = response.json()
                batch = payload.get("features") or []
                if not isinstance(batch, list):
                    break

                features.extend([feature for feature in batch if isinstance(feature, dict)])
                if not payload.get("exceededTransferLimit"):
                    break
                offset += page_size

        return features

    def _feature_to_polygon(self, feature: dict[str, Any]) -> list[AreaPolygonPoint]:
        geometry = feature.get("geometry") or {}
        rings = geometry.get("rings") or []
        if not rings:
            return []

        outer_ring = max((ring for ring in rings if isinstance(ring, list)), key=len, default=[])
        points: list[AreaPolygonPoint] = []
        for point in outer_ring:
            if not isinstance(point, list) or len(point) < 2:
                continue
            longitude = point[0]
            latitude = point[1]
            points.append(AreaPolygonPoint(latitude=float(latitude), longitude=float(longitude)))

        if len(points) > 1 and points[0] == points[-1]:
            points.pop()
        return points

    def _feature_id(self, attributes: dict[str, Any]) -> str | None:
        for key in ("OBJECTID", "ObjectID", "objectid", "FID", "Id", "ID", "id"):
            value = attributes.get(key)
            if value is not None and str(value).strip():
                return str(value).strip()
        return None

    def _feature_name(self, attributes: dict[str, Any]) -> str | None:
        for key in ("NAME", "Name", "name", "LABEL", "Label", "label", "TITLE", "Title", "title"):
            value = attributes.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return None
