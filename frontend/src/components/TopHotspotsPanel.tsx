import { useEffect, useMemo, useState } from "react";
import type { TileLocation } from "../hooks/useTileLocations";
import type { TileDwellCluster } from "../hooks/useTileDetails";

type TopHotspotsPanelProps = {
  backendUrl: string;
  locations: TileLocation[];
};

type TileDetailsPayload = {
  tile_uuid: string;
  label: string;
  dwell_clusters: TileDwellCluster[];
};

type HotspotRow = {
  id: string;
  tileUuid: string;
  tileLabel: string;
  latitude: number;
  longitude: number;
  minutesSpent: number;
  samples: number;
};

function formatMinutes(value: number): string {
  if (value < 60) {
    return `${value} min`;
  }

  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`;
}

export function TopHotspotsPanel({ backendUrl, locations }: TopHotspotsPanelProps) {
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

        const ranked = responses
          .filter((payload): payload is TileDetailsPayload => payload !== null)
          .flatMap((payload) =>
            payload.dwell_clusters
              .filter((cluster) => cluster.minutes_spent > 0)
              .map((cluster) => ({
                id: `${payload.tile_uuid}:${cluster.latitude.toFixed(6)}:${cluster.longitude.toFixed(6)}`,
                tileUuid: payload.tile_uuid,
                tileLabel: payload.label,
                latitude: cluster.latitude,
                longitude: cluster.longitude,
                minutesSpent: cluster.minutes_spent,
                samples: cluster.samples,
              })),
          )
          .sort((a, b) => {
            if (b.minutesSpent !== a.minutesSpent) {
              return b.minutesSpent - a.minutesSpent;
            }
            return b.samples - a.samples;
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
      <p className="tile-list-empty">Top hotspots ranked by all-time minutes spent.</p>
      <table className="leaderboard-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Tile</th>
            <th>Time</th>
            <th>Samples</th>
            <th>Coordinates</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id}>
              <td className="leaderboard-rank">{index + 1}</td>
              <td>{row.tileLabel}</td>
              <td className="leaderboard-value">{formatMinutes(row.minutesSpent)}</td>
              <td>{row.samples}</td>
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
