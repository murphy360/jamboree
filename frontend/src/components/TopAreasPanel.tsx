import type { CustomArea } from "../hooks/useTileDetails";
import type { TileListEntry } from "../utils/tileAge";

type TopAreasPanelProps = {
  groups: Array<{
    area: CustomArea;
    entries: TileListEntry[];
  }>;
  totalActiveTiles: number;
};

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) {
    return "0%";
  }
  return `${Math.round(value * 100)}%`;
}

export function TopAreasPanel({ groups, totalActiveTiles }: TopAreasPanelProps) {
  const ranked = [...groups]
    .filter((group) => group.entries.length > 0)
    .sort((a, b) => b.entries.length - a.entries.length || a.area.name.localeCompare(b.area.name));

  if (ranked.length === 0) {
    return <p className="tile-list-empty">No active tiles are inside named areas right now.</p>;
  }

  return (
    <section className="tile-details-panel">
      <h3 className="tile-details-subtitle">Top Areas</h3>
      <p className="tile-history-meta">
        Ranked by active tiles currently inside each area.
      </p>
      <table className="leaderboard-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Area</th>
            <th>Active Tiles</th>
            <th>Coverage</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((group, index) => {
            const ratio = totalActiveTiles > 0 ? group.entries.length / totalActiveTiles : 0;
            return (
              <tr key={group.area.area_id}>
                <td className="leaderboard-rank">{index + 1}</td>
                <td>{group.area.name}</td>
                <td className="leaderboard-value">{group.entries.length}</td>
                <td className="leaderboard-value">{formatPercent(ratio)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
