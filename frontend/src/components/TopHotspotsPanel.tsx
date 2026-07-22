import { useEffect, useMemo, useState } from "react";
import type { TileLocation } from "../hooks/useTileLocations";
import type { TileDwellCluster } from "../hooks/useTileDetails";

type TopHotspotsPanelProps = {
  backendUrl: string;
  locations: TileLocation[];
  onSelectHotspot: (hotspot: { latitude: number; longitude: number; label: string }) => void;
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
  totalMinutesSpent: number;
  totalScoutPoints: number;
  scoutCount: number;
};

type AggregatedHotspot = {
  latitudeSum: number;
  longitudeSum: number;
  totalMinutesSpent: number;
  totalScoutPoints: number;
  scoutIds: Set<string>;
};

function formatMinutes(value: number): string {
  if (value < 60) {
    return `${value} min`;
  }

  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`;
}

export function TopHotspotsPanel({ backendUrl, locations, onSelectHotspot }: TopHotspotsPanelProps) {
  const [rows, setRows] = useState<HotspotRow[]>([]);
  const [loading, setLoading] = useState(false);

  const normalizedBaseUrl = useMemo(
    () => backendUrl.trim().replace(/\/$/, ""),
    [backendUrl],
  );

  const tileIds = useMemo(
    () => Array.from(new Set(locations.map((location) => location.tile_uuid))),
    [locations],
  );

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
              .forEach((cluster) => {
                const key = `${cluster.latitude.toFixed(4)}:${cluster.longitude.toFixed(4)}`;
                const current = grouped.get(key) ?? {
                  latitudeSum: 0,
                  longitudeSum: 0,
                  totalMinutesSpent: 0,
                  totalScoutPoints: 0,
                  scoutIds: new Set<string>(),
                };

                current.latitudeSum += cluster.latitude;
                current.longitudeSum += cluster.longitude;
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
  }, [normalizedBaseUrl, tileIds]);

  if (loading) {
    return <p className="tile-list-empty">Loading hotspots...</p>;
  }

  if (rows.length === 0) {
    return <p className="tile-list-empty">No dwell hotspots yet.</p>;
  }

  return (
    <section className="leaderboard-panel">
      <p className="tile-list-empty">Top hotspots ranked by total scout points across all scouts.</p>
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
