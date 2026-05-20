import { useEffect, useRef } from "react";
import type { Polygon as LeafletPolygon } from "leaflet";
import { CircleMarker, FeatureGroup, MapContainer, Polygon, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { Breadcrumbs } from "./Breadcrumbs";
import { ArcGISLayers } from "./ArcGISLayers";
import { TileMarkers } from "./TileMarkers";
import type { TileLocation } from "../hooks/useTileLocations";
import type { AreaPolygonPoint, CustomArea } from "../hooks/useTileDetails";
import { EditControl } from "react-leaflet-draw";
import "leaflet-draw/dist/leaflet.draw.css";

type LiveMapProps = {
  locations: TileLocation[];
  areas?: CustomArea[];
  selectedTileUuid: string | null;
  onTileClick: (tile: TileLocation) => void;
  onMapClick: () => void;
  onDrawPolygon?: (points: AreaPolygonPoint[]) => void | Promise<void>;
  breadcrumbs?: TileLocation[];
  breadcrumbColor?: string;
  tileColorByUuid?: Record<string, string>;
  fitSignal?: number;
};

const DEFAULT_CENTER: [number, number] = [38.076, -81.073];

type FitToLocationsProps = {
  locations: TileLocation[];
  fitSignal: number;
};

function FitToLocations({ locations, fitSignal }: FitToLocationsProps) {
  const map = useMap();
  const hasInitialFit = useRef(false);
  const lastFitSignal = useRef(fitSignal);

  useEffect(() => {
    if (locations.length === 0) {
      return;
    }

    const shouldRefit = fitSignal !== lastFitSignal.current;
    if (shouldRefit) {
      lastFitSignal.current = fitSignal;
    }

    if (!shouldRefit && hasInitialFit.current) {
      return;
    }

    if (locations.length === 1) {
      const onlyTile = locations[0];
      map.setView([onlyTile.latitude, onlyTile.longitude], 19, { animate: false });
      hasInitialFit.current = true;
      return;
    }

    const bounds: [number, number][] = locations.map((item) => [item.latitude, item.longitude]);
    map.fitBounds(bounds, {
      animate: false,
      maxZoom: 19,
      padding: [28, 28],
    });
    hasInitialFit.current = true;
  }, [fitSignal, locations, map]);

  return null;
}

type MapClickHandlerProps = {
  onMapClick: () => void;
};

function MapClickHandler({ onMapClick }: MapClickHandlerProps) {
  useMapEvents({
    click: () => {
      onMapClick();
    },
  });
  return null;
}

type SelectedTileHighlightProps = {
  selected: TileLocation | null;
  color: string;
};

function SelectedTileHighlight({ selected, color }: SelectedTileHighlightProps) {
  if (!selected) {
    return null;
  }

  return (
    <CircleMarker
      center={[selected.latitude, selected.longitude]}
      radius={14}
      pathOptions={{ color, weight: 2.5, fillOpacity: 0, opacity: 0.55, dashArray: "2 6" }}
      interactive={false}
    />
  );
}

function findSelectedTile(locations: TileLocation[], selectedTileUuid: string | null): TileLocation | null {
  if (!selectedTileUuid) {
    return null;
  }

  return locations.find((item) => item.tile_uuid === selectedTileUuid) ?? null;
}

function getSelectedMarkerColor(selected: TileLocation | null, tileColorByUuid?: Record<string, string>): string {
  if (!selected || !tileColorByUuid) {
    return "#2563eb";
  }

  return tileColorByUuid[selected.tile_uuid] ?? "#2563eb";
}

function BreadcrumbOverlay({ breadcrumbs, color }: { breadcrumbs?: TileLocation[]; color?: string }) {
  if (!breadcrumbs || breadcrumbs.length <= 1) {
    return null;
  }

  return <Breadcrumbs points={breadcrumbs} color={color || "#0f766e"} />;
}

function toPolygonPoints(layer: LeafletPolygon): AreaPolygonPoint[] {
  const latLngs = layer.getLatLngs();
  const firstRing = Array.isArray(latLngs[0]) ? latLngs[0] : latLngs;
  const points = (firstRing as { lat: number; lng: number }[]).map((item) => ({
    latitude: item.lat,
    longitude: item.lng,
  }));

  if (points.length > 1) {
    const first = points[0];
    const last = points[points.length - 1];
    if (first.latitude === last.latitude && first.longitude === last.longitude) {
      points.pop();
    }
  }

  return points;
}

export function LiveMap({
  locations,
  areas,
  selectedTileUuid,
  onTileClick,
  onMapClick,
  onDrawPolygon,
  breadcrumbs,
  breadcrumbColor,
  tileColorByUuid,
  fitSignal = 0,
}: LiveMapProps) {
  const selected = findSelectedTile(locations, selectedTileUuid);
  const selectedMarkerColor = getSelectedMarkerColor(selected, tileColorByUuid);

  return (
    <section className="map-frame">
      <MapContainer center={DEFAULT_CENTER} zoom={14} className="map-canvas">
        <FitToLocations locations={locations} fitSignal={fitSignal} />
        <MapClickHandler onMapClick={onMapClick} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ArcGISLayers showNSJRegions={true} />
        {areas?.map((area) => (
          <Polygon
            key={area.area_id}
            positions={area.polygon.map((point) => [point.latitude, point.longitude] as [number, number])}
            pathOptions={{ color: "#0f766e", weight: 2, fillColor: "#14b8a6", fillOpacity: 0.12 }}
          >
            <Tooltip sticky>{area.name}</Tooltip>
          </Polygon>
        ))}
        <BreadcrumbOverlay breadcrumbs={breadcrumbs} color={breadcrumbColor} />
        <TileMarkers
          locations={locations}
          selectedTileUuid={selectedTileUuid}
          onTileClick={onTileClick}
          tileColorByUuid={tileColorByUuid}
        />
        <SelectedTileHighlight selected={selected} color={selectedMarkerColor} />
        <FeatureGroup>
          <EditControl
            position="topright"
            onCreated={(e) => {
              const layer = e.layer;
              if (!("getLatLngs" in layer)) {
                return;
              }
              const polygonPoints = toPolygonPoints(layer as LeafletPolygon);
              layer.remove();
              void onDrawPolygon?.(polygonPoints);
            }}
            draw={{
              rectangle: false,
              circle: false,
              marker: false,
              polyline: false,
              circlemarker: false,
            }}
          />
        </FeatureGroup>
      </MapContainer>
    </section>
  );
}

export default LiveMap;
