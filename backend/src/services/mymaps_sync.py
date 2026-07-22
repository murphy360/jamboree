from __future__ import annotations

import asyncio
import logging
import uuid
import xml.etree.ElementTree as ET
from dataclasses import dataclass

import httpx

from src.services.area_store import AreaStore, ImportedAreaSource
from src.services.map_feature_store import MapFeatureStore
from src.services.models import AreaPolygonPoint, MapFeature

LOGGER = logging.getLogger(__name__)
KML_NS = {"kml": "http://www.opengis.net/kml/2.2"}
POLYGON_SOURCE_TYPE = "mymaps_kml_polygon"
FEATURE_SOURCE_TYPE = "mymaps_kml_feature"


@dataclass(frozen=True)
class MyMapsSyncResult:
    source_url: str
    tile_uuid: str
    folders_scanned: int
    polygons_imported: int
    features_imported: int


class MyMapsSyncService:
    """Syncs polygons and map features from a Google My Maps KML URL."""

    def __init__(
        self,
        area_store: AreaStore,
        map_feature_store: MapFeatureStore,
        kml_url: str,
        tile_uuid: str,
        interval_seconds: int,
        enabled: bool,
    ) -> None:
        self._area_store = area_store
        self._map_feature_store = map_feature_store
        self._kml_url = kml_url
        self._tile_uuid = tile_uuid
        self._interval_seconds = interval_seconds
        self._enabled = enabled
        self._shutdown = asyncio.Event()
        self._lock = asyncio.Lock()

    async def stop(self) -> None:
        self._shutdown.set()

    async def run(self) -> None:
        if not self._enabled:
            LOGGER.info("My Maps sync disabled")
            return

        while not self._shutdown.is_set():
            try:
                await self.sync_once()
            except Exception as exc:  # pragma: no cover - defensive logging
                LOGGER.exception("My Maps sync failed: %s", exc)

            try:
                await asyncio.wait_for(self._shutdown.wait(), timeout=self._interval_seconds)
            except asyncio.TimeoutError:
                continue

    async def sync_once(self) -> MyMapsSyncResult:
        async with self._lock:
            payload = await self._fetch_kml()
            root = ET.fromstring(payload)

            folders = root.findall(".//kml:Folder", KML_NS)
            polygon_count = 0
            feature_rows: list[MapFeature] = []

            # Remove legacy imports before refreshing from KML.
            self._area_store.delete_non_manual_areas(self._tile_uuid)
            self._map_feature_store.delete_non_manual_features(self._tile_uuid)

            for folder in folders:
                folder_name = (folder.findtext("kml:name", default="", namespaces=KML_NS) or "").strip()
                for placemark in folder.findall("kml:Placemark", KML_NS):
                    name = (placemark.findtext("kml:name", default="Unnamed", namespaces=KML_NS) or "Unnamed").strip()
                    description = (
                        placemark.findtext("kml:description", default="", namespaces=KML_NS) or ""
                    ).strip()
                    source_feature_id = placemark.attrib.get("id") or str(uuid.uuid4())

                    polygons = self._extract_polygons(placemark)
                    for index, polygon in enumerate(polygons, start=1):
                        area_name = name if len(polygons) == 1 else f"{name} (part {index})"
                        source = ImportedAreaSource(
                            source_type=POLYGON_SOURCE_TYPE,
                            source_name=folder_name or "My Maps",
                            source_url=self._kml_url,
                            source_feature_id=f"{source_feature_id}:{index}",
                        )
                        self._area_store.upsert_imported_area(
                            tile_uuid=self._tile_uuid,
                            name=area_name,
                            polygon=polygon,
                            source=source,
                        )
                        polygon_count += 1

                    feature_rows.extend(
                        self._extract_non_polygon_features(
                            placemark=placemark,
                            folder_name=folder_name,
                            feature_name=name,
                            description=description,
                            source_feature_id=source_feature_id,
                        )
                    )

            feature_count = self._map_feature_store.replace_source_features(
                tile_uuid=self._tile_uuid,
                source_type=FEATURE_SOURCE_TYPE,
                source_url=self._kml_url,
                features=feature_rows,
            )

            result = MyMapsSyncResult(
                source_url=self._kml_url,
                tile_uuid=self._tile_uuid,
                folders_scanned=len(folders),
                polygons_imported=polygon_count,
                features_imported=feature_count,
            )
            LOGGER.info(
                "My Maps sync complete folders=%s polygons=%s features=%s",
                result.folders_scanned,
                result.polygons_imported,
                result.features_imported,
            )
            return result

    async def _fetch_kml(self) -> bytes:
        async with httpx.AsyncClient(timeout=45) as client:
            response = await client.get(self._kml_url)
            response.raise_for_status()
            return response.content

    def _extract_polygons(self, placemark: ET.Element) -> list[list[AreaPolygonPoint]]:
        polygons: list[list[AreaPolygonPoint]] = []

        for poly in placemark.findall("kml:Polygon", KML_NS):
            points = self._polygon_points(poly)
            if len(points) >= 3:
                polygons.append(points)

        for poly in placemark.findall(".//kml:MultiGeometry/kml:Polygon", KML_NS):
            points = self._polygon_points(poly)
            if len(points) >= 3:
                polygons.append(points)

        return polygons

    def _extract_non_polygon_features(
        self,
        placemark: ET.Element,
        folder_name: str,
        feature_name: str,
        description: str,
        source_feature_id: str,
    ) -> list[MapFeature]:
        features: list[MapFeature] = []

        for point in placemark.findall("kml:Point", KML_NS):
            coords = self._coordinates_text(point.find("kml:coordinates", KML_NS))
            parsed = self._parse_coordinates(coords)
            if parsed:
                features.append(
                    self._feature(
                        name=feature_name,
                        folder_name=folder_name,
                        geometry_type="Point",
                        geometry={"coordinates": parsed[0]},
                        description=description,
                        source_feature_id=f"{source_feature_id}:point",
                    )
                )

        for line in placemark.findall("kml:LineString", KML_NS):
            coords = self._coordinates_text(line.find("kml:coordinates", KML_NS))
            parsed = self._parse_coordinates(coords)
            if len(parsed) >= 2:
                features.append(
                    self._feature(
                        name=feature_name,
                        folder_name=folder_name,
                        geometry_type="LineString",
                        geometry={"coordinates": parsed},
                        description=description,
                        source_feature_id=f"{source_feature_id}:line",
                    )
                )

        for line in placemark.findall(".//kml:MultiGeometry/kml:LineString", KML_NS):
            coords = self._coordinates_text(line.find("kml:coordinates", KML_NS))
            parsed = self._parse_coordinates(coords)
            if len(parsed) >= 2:
                features.append(
                    self._feature(
                        name=feature_name,
                        folder_name=folder_name,
                        geometry_type="LineString",
                        geometry={"coordinates": parsed},
                        description=description,
                        source_feature_id=f"{source_feature_id}:multiline:{len(features)}",
                    )
                )

        return features

    def _feature(
        self,
        name: str,
        folder_name: str,
        geometry_type: str,
        geometry: dict,
        description: str,
        source_feature_id: str,
    ) -> MapFeature:
        return MapFeature(
            name=name,
            tile_uuid=self._tile_uuid,
            folder_name=folder_name,
            geometry_type=geometry_type,
            geometry=geometry,
            source_type=FEATURE_SOURCE_TYPE,
            source_name=description or folder_name,
            source_url=self._kml_url,
            source_feature_id=source_feature_id,
        )

    def _polygon_points(self, polygon: ET.Element) -> list[AreaPolygonPoint]:
        coords = self._coordinates_text(
            polygon.find(".//kml:outerBoundaryIs/kml:LinearRing/kml:coordinates", KML_NS)
        )
        parsed = self._parse_coordinates(coords)
        points = [AreaPolygonPoint(latitude=lat, longitude=lon) for lon, lat in parsed]
        if len(points) > 1 and points[0] == points[-1]:
            points = points[:-1]
        return points

    def _coordinates_text(self, element: ET.Element | None) -> str:
        if element is None or element.text is None:
            return ""
        return element.text.strip()

    def _parse_coordinates(self, text: str) -> list[tuple[float, float]]:
        points: list[tuple[float, float]] = []
        if not text:
            return points

        for token in text.split():
            parts = token.split(",")
            if len(parts) < 2:
                continue
            lon = float(parts[0])
            lat = float(parts[1])
            points.append((lon, lat))
        return points
