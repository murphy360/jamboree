import { useMemo } from "react";
import { Marker, Polygon } from "react-leaflet";
import type { DragEndEvent, LeafletMouseEvent } from "leaflet";
import type { AreaPolygonPoint, CustomArea } from "../hooks/useTileDetails";
import { getAreaPolygonStyle } from "../utils/areaStyles";

type AreaPolygonEditorOverlayProps = {
  area: CustomArea;
  polygon: AreaPolygonPoint[];
  onChange: (polygon: AreaPolygonPoint[]) => void;
  onSelectArea?: (areaId: string) => void;
};

function toPositions(polygon: AreaPolygonPoint[]): [number, number][] {
  return polygon.map((point) => [point.latitude, point.longitude]);
}

function clonePoint(point: AreaPolygonPoint): AreaPolygonPoint {
  return { latitude: point.latitude, longitude: point.longitude };
}

export function AreaPolygonEditorOverlay({ area, polygon, onChange, onSelectArea }: AreaPolygonEditorOverlayProps) {
  const positions = useMemo(() => toPositions(polygon), [polygon]);

  const handleMarkerDragEnd = (index: number) => (event: DragEndEvent) => {
    const marker = event.target;
    const nextLatLng = marker.getLatLng();
    const nextPolygon = polygon.map(clonePoint);
    nextPolygon[index] = { latitude: nextLatLng.lat, longitude: nextLatLng.lng };
    onChange(nextPolygon);
  };

  const handlePolygonClick = (event: LeafletMouseEvent) => {
    event.originalEvent.stopPropagation();
    onSelectArea?.(area.area_id);
  };

  return (
    <>
      <Polygon
        positions={positions}
        pathOptions={{
          ...getAreaPolygonStyle(area.name),
          weight: 3,
          opacity: 1,
          fillOpacity: 0.22,
          dashArray: "6 6",
        }}
        interactive={true}
        bubblingMouseEvents={false}
        eventHandlers={{ click: handlePolygonClick }}
      />
      {positions.map((position, index) => (
        <Marker
          key={`${area.area_id}-${index}`}
          position={position}
          draggable={true}
          eventHandlers={{ dragend: handleMarkerDragEnd(index) }}
        />
      ))}
    </>
  );
}