import { useCallback, useEffect, useState } from "react";
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import { AreaPolygons } from "./AreaPolygons";
import { ArcGISLayers } from "./ArcGISLayers";
import type { TileDwellCluster, CustomArea } from "../hooks/useTileDetails";
import type { TileLocation } from "../hooks/useTileLocations";

type SelectedHotspot = {
  latitude: number;
  longitude: number;
  label: string;
};

type TileDetailsMapProps = {
  history: TileLocation[];
  dwellClusters: TileDwellCluster[];
  customAreas?: CustomArea[];
  selectedHotspot?: SelectedHotspot | null;
  showGisLayers?: boolean;
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

function FocusSelectedHotspot({ selectedHotspot }: { selectedHotspot?: SelectedHotspot | null }) {
  const map = useMap();

  useEffect(() => {
    if (!selectedHotspot) {
      return;
    }

    map.panTo([selectedHotspot.latitude, selectedHotspot.longitude], { animate: true });
  }, [map, selectedHotspot]);

  return null;
}

function DwellClusterMarkers({ clusters, maxMinutes }: { clusters: TileDwellCluster[]; maxMinutes: number }) {
  return (
    <>
      {clusters.slice(0, 60).map((cluster) => {
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
    </>
  );
}

export function TileDetailsMap({ history, dwellClusters, customAreas = [], selectedHotspot, showGisLayers = true }: TileDetailsMapProps) {
  const path = history.map((item) => [item.latitude, item.longitude] as [number, number]);
  const start = history[0];
  const end = history[history.length - 1];
  const maxMinutes = dwellClusters.reduce((max, cluster) => Math.max(max, cluster.minutes_spent), 0);
  const [visibleAreaLabels, setVisibleAreaLabels] = useState<Record<string, boolean>>({});

  const toggleAreaLabel = useCallback((areaId: string) => {
    setVisibleAreaLabels((current) => ({
      ...current,
      [areaId]: !current[areaId],
    }));
  }, []);

  return (
    <section className="tile-details-map-frame">
      <MapContainer
        center={start ? [start.latitude, start.longitude] : DEFAULT_CENTER}
        zoom={15}
        className="tile-details-map"
      >
        <FocusSelectedHotspot selectedHotspot={selectedHotspot} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {showGisLayers ? <ArcGISLayers showNSJRegions={true} showSummitLakes={true} /> : null}
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
        <DwellClusterMarkers clusters={dwellClusters} maxMinutes={maxMinutes} />
        <AreaPolygons areas={customAreas} visibleLabels={visibleAreaLabels} onToggleLabel={toggleAreaLabel} />
        {selectedHotspot ? (
          <CircleMarker
            center={[selectedHotspot.latitude, selectedHotspot.longitude]}
            radius={12}
            pathOptions={{ color: "#0f172a", fillColor: "#facc15", fillOpacity: 0.9, weight: 3 }}
          >
            <Tooltip permanent direction="top" offset={[0, -10]}>
              {selectedHotspot.label}
            </Tooltip>
          </CircleMarker>
        ) : null}
      </MapContainer>
    </section>
  );
}
