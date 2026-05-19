import { useEffect, useRef } from "react";
import { CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { Breadcrumbs } from "./Breadcrumbs";
import { ArcGISLayers } from "./ArcGISLayers";
import { TileMarkers } from "./TileMarkers";
import type { TileLocation } from "../hooks/useTileLocations";

type LiveMapProps = {
  locations: TileLocation[];
  selectedTileUuid: string | null;
  onTileClick: (tile: TileLocation) => void;
  onMapClick: () => void;
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

export function LiveMap({
  locations,
  selectedTileUuid,
  onTileClick,
  onMapClick,
  breadcrumbs,
  breadcrumbColor,
  tileColorByUuid,
  fitSignal = 0,
}: LiveMapProps) {
  const selected = selectedTileUuid ? locations.find((t) => t.tile_uuid === selectedTileUuid) : null;
  const selectedMarkerColor = selected ? tileColorByUuid?.[selected.tile_uuid] ?? "#2563eb" : "#2563eb";
  const showBreadcrumbs = breadcrumbs && breadcrumbs.length > 1;

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
        {showBreadcrumbs && <Breadcrumbs points={breadcrumbs} color={breadcrumbColor || "#0f766e"} />}
        <TileMarkers
          locations={locations}
          selectedTileUuid={selectedTileUuid}
          onTileClick={onTileClick}
          tileColorByUuid={tileColorByUuid}
        />
        {selected && (
          <CircleMarker
            center={[selected.latitude, selected.longitude]}
            radius={14}
            pathOptions={{ color: selectedMarkerColor, weight: 2.5, fillOpacity: 0, opacity: 0.55, dashArray: "2 6" }}
            interactive={false}
          />
        )}
      </MapContainer>
    </section>
  );
}
