import { CircleMarker, MapContainer, Polyline, TileLayer } from "react-leaflet";
import { ArcGISLayers } from "./ArcGISLayers";
import type { TileDwellCluster } from "../hooks/useTileDetails";
import type { TileLocation } from "../hooks/useTileLocations";

type TileDetailsMapProps = {
  history: TileLocation[];
  dwellClusters: TileDwellCluster[];
};

const DEFAULT_CENTER: [number, number] = [38.076, -81.073];

function getIntensityColor(ratio: number): string {
  if (ratio >= 0.8) {
    return "#dc2626";
  }
  if (ratio >= 0.6) {
    return "#f97316";
  }
  if (ratio >= 0.4) {
    return "#f59e0b";
  }
  if (ratio >= 0.2) {
    return "#84cc16";
  }
  return "#22c55e";
}

export function TileDetailsMap({ history, dwellClusters }: TileDetailsMapProps) {
  const path = history.map((item) => [item.latitude, item.longitude] as [number, number]);
  const start = history[0];
  const end = history[history.length - 1];
  const maxMinutes = dwellClusters.reduce((max, cluster) => Math.max(max, cluster.minutes_spent), 0);

  return (
    <section className="tile-details-map-frame">
      <MapContainer
        center={start ? [start.latitude, start.longitude] : DEFAULT_CENTER}
        zoom={15}
        className="tile-details-map"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ArcGISLayers showNSJRegions={true} />
        {path.length > 1 ? <Polyline positions={path} pathOptions={{ color: "#0f766e", weight: 3 }} /> : null}
        {start ? (
          <CircleMarker
            center={[start.latitude, start.longitude]}
            radius={6}
            pathOptions={{ color: "#0369a1", fillColor: "#0ea5e9", fillOpacity: 0.8 }}
          />
        ) : null}
        {end ? (
          <CircleMarker
            center={[end.latitude, end.longitude]}
            radius={7}
            pathOptions={{ color: "#166534", fillColor: "#22c55e", fillOpacity: 0.9 }}
          />
        ) : null}
        {dwellClusters.slice(0, 60).map((cluster) => {
          const ratio = maxMinutes > 0 ? cluster.minutes_spent / maxMinutes : 0;
          const color = getIntensityColor(ratio);
          const radius = Math.min(16, 4 + Math.round(ratio * 12));

          return (
            <CircleMarker
              key={`${cluster.latitude}-${cluster.longitude}-${cluster.samples}`}
              center={[cluster.latitude, cluster.longitude]}
              radius={radius}
              pathOptions={{ color, fillColor: color, fillOpacity: 0.3 + ratio * 0.45, weight: 1.5 }}
            />
          );
        })}
      </MapContainer>
    </section>
  );
}
