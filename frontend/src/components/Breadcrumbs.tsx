import { CircleMarker, Polyline, Tooltip } from "react-leaflet";
import type { TileLocation } from "../hooks/useTileLocations";

interface BreadcrumbsProps {
  points: TileLocation[];
  color?: string;
}

export function Breadcrumbs({ points, color = "#0f766e" }: BreadcrumbsProps) {
  if (points.length < 2) return null;
  const polylinePositions: [number, number][] = points.map((p) => [p.latitude, p.longitude]);
  return (
    <>
      <Polyline positions={polylinePositions} pathOptions={{ color, weight: 3, opacity: 0.5 }} />
      {points.map((point) => (
        <CircleMarker
          key={`${point.tile_uuid}-${point.observed_at}`}
          center={[point.latitude, point.longitude]}
          radius={5}
          pathOptions={{ color, fillColor: color, fillOpacity: 0.5, opacity: 0.7 }}
        >
          <Tooltip direction="top" offset={[0, -6]} opacity={0.8} permanent={false}>
            {new Date(point.observed_at).toLocaleTimeString()}
          </Tooltip>
        </CircleMarker>
      ))}
    </>
  );
}
