import { useEffect, useMemo, useState } from "react";
import type { TileLocation } from "../hooks/useTileLocations";
import type { CustomArea, TileDwellCluster } from "../hooks/useTileDetails";

type SelectedHotspot = {
  latitude: number;
  longitude: number;
  label: string;
  radiusMeters: number;
} | null;

type TopHotspotsPanelProps = {
  backendUrl: string;
  locations: TileLocation[];
  areas: CustomArea[];
  onSelectHotspot: (hotspot: { latitude: number; longitude: number; label: string; radiusMeters: number }) => void;
};

type TileDetailsPayload = {
  tile_uuid: string;
  label: string;
  dwell_clusters: TileDwellCluster[];
};

type HotspotRow = {
  id: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  totalMinutesSpent: number;
  totalScoutPoints: number;
  scoutCount: number;
};

type AggregatedHotspot = {
  latitudeSum: number;
  longitudeSum: number;
  weightedRadiusSum: number;
  totalMinutesSpent: number;
  totalScoutPoints: number;
  scoutIds: Set<string>;
};

function pointInPolygon(lat: number, lon: number, polygon: { latitude: number; longitude: number }[]): boolean {
  const n = polygon.length;
  if (n < 3) return false;
  const epsilon = 1e-9;

  const pointOnSegment = (
    pointLat: number,
    pointLon: number,
    startLat: number,
    startLon: number,
    endLat: number,
    endLon: number,
  ): boolean => {
    const cross = (pointLat - startLat) * (endLon - startLon) - (pointLon - startLon) * (endLat - startLat);
    if (Math.abs(cross) > epsilon) return false;

    const dot = (pointLat - startLat) * (endLat - startLat) + (pointLon - startLon) * (endLon - startLon);
    if (dot < -epsilon) return false;

    const squaredLen = (endLat - startLat) ** 2 + (endLon - startLon) ** 2;
    return dot <= squaredLen + epsilon;
  };

  let inside = false;
  let j = n - 1;
  for (let i = 0; i < n; i += 1) {
    const piLat = polygon[i].latitude;
    const piLon = polygon[i].longitude;
    const pjLat = polygon[j].latitude;
    const pjLon = polygon[j].longitude;

    if (pointOnSegment(lat, lon, piLat, piLon, pjLat, pjLon)) return true;

    const lonCrosses = (piLon > lon) !== (pjLon > lon);
    if (lonCrosses) {
      const latIntersect =
        ((pjLat - piLat) * (lon - piLon)) / (pjLon - piLon) +
        piLat;
      if (lat < latIntersect) inside = !inside;
    }
    j = i;
  }
  return inside;
}

function formatMinutes(value: number): string {
  if (value < 60) {
    return `${value} min`;
  }

  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`;
}

export function TopHotspotsPanel({
  backendUrl,
  locations,
  areas,
  onSelectHotspot,
}: TopHotspotsPanelProps) {
  const [rows, setRows] = useState<HotspotRow[]>([]);
  const [loading, setLoading] = useState(false);

  const normalizedBaseUrl = useMemo(
    () => backendUrl.trim().replace(/\/$/, ""),
    [backendUrl],
  );

  const tileIds = useMemo(() => {
    const unique = Array.from(new Set(locations.map((location) => location.tile_uuid)));
    unique.sort();
    return unique;
  }, [locations]);

  const tileIdsKey = useMemo(() => tileIds.join("|"), [tileIds]);
  const areaKey = useMemo(() => {
    const normalized = [...areas]
      .sort((a, b) => a.area_id.localeCompare(b.area_id))
      .map(
        (area) =>
          `${area.area_id}:${area.updated_at}:${area.polygon
            .map((point) => `${point.latitude.toFixed(6)},${point.longitude.toFixed(6)}`)
            .join(";")}`,
      );
    return normalized.join("|");
  }, [areas]);

  useEffect(() => {
    if (!normalizedBaseUrl || tileIds.length === 0) {
      setRows([]);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const responses = await Promise.all(
          tileIds.map(async (tileUuid) => {
            const response = await fetch(`${normalizedBaseUrl}/tiles/${encodeURIComponent(tileUuid)}/details`);
            if (!response.ok) {
              return null;
            }
            return (await response.json()) as TileDetailsPayload;
          }),
        );

        const grouped = new Map<string, AggregatedHotspot>();

        responses
          .filter((payload): payload is TileDetailsPayload => payload !== null)
          .forEach((payload) => {
            payload.dwell_clusters
              .filter((cluster) => cluster.samples > 0)
              .filter((cluster) => !areas.some((area) => pointInPolygon(cluster.latitude, cluster.longitude, area.polygon)))
              .forEach((cluster) => {
                const key = `${cluster.latitude.toFixed(4)}:${cluster.longitude.toFixed(4)}`;
                const current = grouped.get(key) ?? {
                  latitudeSum: 0,
                  longitudeSum: 0,
                  weightedRadiusSum: 0,
                  totalMinutesSpent: 0,
                  totalScoutPoints: 0,
                  scoutIds: new Set<string>(),
                };

                const sampleWeight = Math.max(cluster.samples, 1);
                current.latitudeSum += cluster.latitude;
                current.longitudeSum += cluster.longitude;
                current.weightedRadiusSum += 50 * sampleWeight;
                current.totalMinutesSpent += cluster.minutes_spent;
                current.totalScoutPoints += cluster.samples;
                current.scoutIds.add(payload.tile_uuid);
                grouped.set(key, current);
              });
          });

        const ranked = [...grouped.entries()]
          .map(([key, bucket]) => {
            const count = bucket.scoutIds.size;
            return {
              id: key,
              latitude: bucket.latitudeSum / count,
              longitude: bucket.longitudeSum / count,
              radiusMeters: Math.max(35, Math.min(120, bucket.weightedRadiusSum / Math.max(bucket.totalScoutPoints, 1))),
              totalMinutesSpent: bucket.totalMinutesSpent,
              totalScoutPoints: bucket.totalScoutPoints,
              scoutCount: count,
            } satisfies HotspotRow;
          })
          .sort((a, b) => {
            if (b.totalScoutPoints !== a.totalScoutPoints) {
              return b.totalScoutPoints - a.totalScoutPoints;
            }
            return b.totalMinutesSpent - a.totalMinutesSpent;
          })
          .slice(0, 100);

        if (!cancelled) {
          setRows(ranked);
        }
      } catch {
        if (!cancelled) {
          setRows([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [areas, areaKey, normalizedBaseUrl, tileIdsKey]);

  if (loading) {
    return <p className="tile-list-empty">Loading hotspots...</p>;
  }

  if (rows.length === 0) {
    return <p className="tile-list-empty">No dwell hotspots yet.</p>;
  }

  return (
    <section className="leaderboard-panel">
      <p className="tile-list-empty">Top hotspots outside named areas, ranked by total scout points across all scouts.</p>
      <table className="leaderboard-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Scout Points</th>
            <th>Total Time</th>
            <th>Scouts</th>
            <th>Coordinates</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={row.id}
              className="top-hotspot-row"
              onClick={() =>
                onSelectHotspot({
                  latitude: row.latitude,
                  longitude: row.longitude,
                  label: `Top Hotspot #${index + 1}`,
                  radiusMeters: row.radiusMeters,
                })
              }
            >
              <td className="leaderboard-rank">{index + 1}</td>
              <td>{row.totalScoutPoints}</td>
              <td className="leaderboard-value">{formatMinutes(row.totalMinutesSpent)}</td>
              <td>{row.scoutCount}</td>
              <td>
                {row.latitude.toFixed(5)}, {row.longitude.toFixed(5)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
