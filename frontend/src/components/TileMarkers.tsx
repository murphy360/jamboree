import { useMemo } from "react";
import { divIcon, point } from "leaflet";
import { Marker, Popup } from "react-leaflet";
import type { TileLocation } from "../hooks/useTileLocations";

type TileMarkersProps = {
  locations: TileLocation[];
  selectedTileUuid: string | null;
  onTileClick: (tile: TileLocation) => void;
  tileColorByUuid?: Record<string, string>;
};

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

export function TileMarkers({
  locations,
  selectedTileUuid,
  onTileClick,
  tileColorByUuid,
}: TileMarkersProps) {
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

  return (
    <>
      {locations.map((item) => {
        const color = tileColorByUuid?.[item.tile_uuid] ?? "#2563eb";
        const isSelected = item.tile_uuid === selectedTileUuid;
        const iconKey = isSelected ? `${color}:selected` : color;

        return (
          <Marker
            key={item.tile_uuid}
            position={[item.latitude, item.longitude]}
            icon={markerIcons.get(iconKey) ?? createMarkerIcon("#2563eb")}
            opacity={isSelected ? 1 : 0.85}
            zIndexOffset={isSelected ? 1000 : 0}
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
        );
      })}
    </>
  );
}
