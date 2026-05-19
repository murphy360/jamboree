import { useEffect, useMemo } from "react";
import { divIcon, point } from "leaflet";
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { Breadcrumbs } from "./Breadcrumbs";
import type { TileLocation } from "../hooks/useTileLocations";

type LiveMapProps = {
  locations: TileLocation[];
  selectedTileUuid: string | null;
  onTileClick: (tile: TileLocation) => void;
  onMapClick: () => void;
  breadcrumbs?: TileLocation[];
  breadcrumbColor?: string;
  tileColorByUuid?: Record<string, string>;
};

const DEFAULT_CENTER: [number, number] = [38.076, -81.073];

type FitToLocationsProps = {
  locations: TileLocation[];
};

function FitToLocations({ locations }: FitToLocationsProps) {
  const map = useMap();

  useEffect(() => {
    if (locations.length === 0) {
      return;
    }

    if (locations.length === 1) {
      const onlyTile = locations[0];
      map.setView([onlyTile.latitude, onlyTile.longitude], 19, { animate: false });
      return;
    }

    const bounds: [number, number][] = locations.map((item) => [item.latitude, item.longitude]);
    map.fitBounds(bounds, {
      animate: false,
      maxZoom: 19,
      padding: [28, 28],
    });
  }, [locations, map]);

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

function createMarkerIcon(color: string, selected = false) {
  const safeColor = color || "#2563eb";
  const selectedClass = selected ? " tile-marker-shell-selected" : "";
  const dotClass = selected ? "tile-marker-dot tile-marker-dot-selected" : "tile-marker-dot";
  const selectedRing = selected ? "box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.35), 0 3px 10px rgba(15, 23, 42, 0.35);" : "";

  return divIcon({
    className: `tile-marker-shell${selectedClass}`,
    html: `<span class='${dotClass}' style='background:${safeColor};${selectedRing}'></span>`,
    iconSize: point(18, 18),
    iconAnchor: point(9, 9),
  });
}

export function LiveMap({ locations, selectedTileUuid, onTileClick, onMapClick, breadcrumbs, breadcrumbColor, tileColorByUuid }: LiveMapProps) {
  // Find the selected tile's current position for highlighting
  const selected = selectedTileUuid ? locations.find((t) => t.tile_uuid === selectedTileUuid) : null;
  const markerIcons = useMemo(() => {
    const icons = new Map<string, ReturnType<typeof divIcon>>();

    locations.forEach((item) => {
      const color = tileColorByUuid?.[item.tile_uuid] ?? "#2563eb";
      if (!icons.has(color)) {
        icons.set(color, createMarkerIcon(color));
      }

      if (!icons.has(`${color}:selected`)) {
        icons.set(`${color}:selected`, createMarkerIcon(color, true));
      }
    });

    return icons;
  }, [locations, tileColorByUuid]);

  const selectedMarkerColor = selected ? tileColorByUuid?.[selected.tile_uuid] ?? "#2563eb" : "#2563eb";

  return (
    <section className="map-frame">
      <MapContainer center={DEFAULT_CENTER} zoom={14} className="map-canvas">
        <FitToLocations locations={locations} />
        <MapClickHandler onMapClick={onMapClick} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {/* Breadcrumbs polyline and points */}
        {breadcrumbs && breadcrumbs.length > 1 && <Breadcrumbs points={breadcrumbs} color={breadcrumbColor || "#0f766e"} />}
        {/* Live markers */}
        {locations.map((item) => (
          <Marker
            key={item.tile_uuid}
            position={[item.latitude, item.longitude]}
            icon={
              item.tile_uuid === selectedTileUuid
                ? markerIcons.get(`${tileColorByUuid?.[item.tile_uuid] ?? "#2563eb"}:selected`) ?? createMarkerIcon("#2563eb", true)
                : markerIcons.get(tileColorByUuid?.[item.tile_uuid] ?? "#2563eb") ?? createMarkerIcon("#2563eb")
            }
            opacity={item.tile_uuid === selectedTileUuid ? 1 : 0.85}
            zIndexOffset={item.tile_uuid === selectedTileUuid ? 1000 : 0}
            eventHandlers={{
              click: (event) => {
                event.originalEvent.stopPropagation();
                onTileClick(item);
              },
            }}
          >
            <Popup>
              <strong>{item.label}</strong>
              <br />
              Lat: {item.latitude.toFixed(5)}
              <br />
              Lng: {item.longitude.toFixed(5)}
            </Popup>
          </Marker>
        ))}
        {/* Highlight ring for selected marker */}
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
