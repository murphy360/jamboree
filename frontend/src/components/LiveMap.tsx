import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { Polygon as LeafletPolygon } from "leaflet";
import { CircleMarker, FeatureGroup, MapContainer, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { Breadcrumbs } from "./Breadcrumbs";
import { AreaPolygons } from "./AreaPolygons";
import { ArcGISLayers } from "./ArcGISLayers";
import { TileMarkers } from "./TileMarkers";
import type { TileLocation } from "../hooks/useTileLocations";
import type { AreaPolygonPoint, CustomArea } from "../hooks/useTileDetails";
import type { ImportedMapPoint } from "../hooks/useMapFeatures";
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
  showGisLayers?: boolean;
  importedPoints?: ImportedMapPoint[];
  focusedHotspot?: { latitude: number; longitude: number; label: string } | null;
  focusSignal?: number;
  onFocusedHotspotHandled?: () => void;
};

const DEFAULT_CENTER: [number, number] = [38.076, -81.073];

type FitToLocationsProps = {
  locations: TileLocation[];
  fitSignal: number;
};

type FocusHotspotProps = {
  focusedHotspot: { latitude: number; longitude: number; label: string } | null;
  focusSignal: number;
  onHandled?: () => void;
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

function FocusHotspot({ focusedHotspot, focusSignal, onHandled }: FocusHotspotProps) {
  const map = useMap();

  useEffect(() => {
    if (!focusedHotspot) {
      return;
    }

    map.flyTo([focusedHotspot.latitude, focusedHotspot.longitude], Math.max(map.getZoom(), 17), {
      duration: 0.8,
    });
    onHandled?.();
  }, [focusedHotspot, focusSignal, map, onHandled]);

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

function ImportedPointsOverlay({ points }: { points: ImportedMapPoint[] }) {
  if (points.length === 0) {
    return null;
  }

  return (
    <>
      {points.map((point) => (
        <CircleMarker
          key={point.id}
          center={[point.latitude, point.longitude]}
          radius={5}
          pathOptions={{ color: "#b45309", fillColor: "#f59e0b", fillOpacity: 0.8, weight: 1.5 }}
        >
          <Tooltip permanent direction="top" offset={[0, -8]} className="imported-point-label">
            {point.name}
          </Tooltip>
        </CircleMarker>
      ))}
    </>
  );
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

type PolygonDrawControlProps = {
  onDrawPolygon: (points: AreaPolygonPoint[]) => void | Promise<void>;
};

const PolygonDrawControl = memo(function PolygonDrawControl({ onDrawPolygon }: PolygonDrawControlProps) {
  const onDrawPolygonRef = useRef(onDrawPolygon);

  useEffect(() => {
    onDrawPolygonRef.current = onDrawPolygon;
  }, [onDrawPolygon]);

  const handleCreated = useCallback((event: { layer: unknown }) => {
    const layer = event.layer;
    if (!layer || typeof layer !== "object" || !("getLatLngs" in layer) || !("remove" in layer)) {
      return;
    }

    const polygonLayer = layer as LeafletPolygon;
    const polygonPoints = toPolygonPoints(polygonLayer);
    polygonLayer.remove();
    void onDrawPolygonRef.current(polygonPoints);
  }, []);

  return (
    <FeatureGroup>
      <EditControl
        position="topright"
        onCreated={handleCreated}
        draw={{
          rectangle: false,
          circle: false,
          marker: false,
          polyline: false,
          circlemarker: false,
        }}
        edit={{
          edit: false,
          remove: false,
        }}
      />
    </FeatureGroup>
  );
});

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
  showGisLayers = true,
  importedPoints = [],
  focusedHotspot = null,
  focusSignal = 0,
  onFocusedHotspotHandled,
}: LiveMapProps) {
  const selected = findSelectedTile(locations, selectedTileUuid);
  const selectedMarkerColor = getSelectedMarkerColor(selected, tileColorByUuid);
  const canDrawPolygons = Boolean(onDrawPolygon);
  const [visibleAreaLabels, setVisibleAreaLabels] = useState<Record<string, boolean>>({});

  const toggleAreaLabel = useCallback((areaId: string) => {
    setVisibleAreaLabels((current) => ({
      ...current,
      [areaId]: !current[areaId],
    }));
  }, []);

  return (
    <section className="map-frame">
      <MapContainer center={DEFAULT_CENTER} zoom={14} className="map-canvas">
        <FitToLocations locations={locations} fitSignal={fitSignal} />
        <FocusHotspot
          focusedHotspot={focusedHotspot}
          focusSignal={focusSignal}
          onHandled={onFocusedHotspotHandled}
        />
        <MapClickHandler onMapClick={onMapClick} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {showGisLayers ? <ArcGISLayers showNSJRegions={true} showSummitLakes={true} /> : null}
        <AreaPolygons areas={areas ?? []} visibleLabels={visibleAreaLabels} onToggleLabel={toggleAreaLabel} />
        <BreadcrumbOverlay breadcrumbs={breadcrumbs} color={breadcrumbColor} />
        <ImportedPointsOverlay points={importedPoints} />
        {focusedHotspot ? (
          <CircleMarker
            center={[focusedHotspot.latitude, focusedHotspot.longitude]}
            radius={9}
            pathOptions={{ color: "#0f172a", fillColor: "#facc15", fillOpacity: 0.92, weight: 2.5 }}
          >
            <Tooltip direction="top" offset={[0, -10]}>
              {focusedHotspot.label}
            </Tooltip>
          </CircleMarker>
        ) : null}
        <TileMarkers
          locations={locations}
          selectedTileUuid={selectedTileUuid}
          onTileClick={onTileClick}
          tileColorByUuid={tileColorByUuid}
        />
        <SelectedTileHighlight selected={selected} color={selectedMarkerColor} />
        {canDrawPolygons && onDrawPolygon ? <PolygonDrawControl onDrawPolygon={onDrawPolygon} /> : null}
      </MapContainer>
    </section>
  );
}

export default LiveMap;
