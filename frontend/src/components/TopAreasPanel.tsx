import { useState } from "react";
import { useTopAreas } from "../hooks/useTopAreas";

type TopAreasPanelProps = {
  backendUrl: string;
};

function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return "0m";
  }
  const wholeMinutes = Math.round(minutes);
  const h = Math.floor(wholeMinutes / 60);
  const m = wholeMinutes % 60;
  if (h > 0) {
    return `${h}h ${m}m`;
  }
  return `${m}m`;
}

export function TopAreasPanel({ backendUrl }: TopAreasPanelProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [dateMode, setDateMode] = useState<"daily" | "overall">("overall");
  const [selectedDate, setSelectedDate] = useState<string>(today);

  const queryDate = dateMode === "daily" ? selectedDate : null;
  const { data, loading, error, refresh } = useTopAreas(backendUrl, queryDate, 20);

  return (
    <section className="leaderboard-panel">
      <div className="leaderboard-header">
        <h2>Top Areas</h2>
        <button type="button" className="leaderboard-refresh-btn" onClick={() => void refresh()}>
          Refresh
        </button>
      </div>

      <div className="leaderboard-controls">
        <div className="leaderboard-mode-toggle">
          <button
            type="button"
            className={dateMode === "daily" ? "leaderboard-mode-btn is-active" : "leaderboard-mode-btn"}
            onClick={() => setDateMode("daily")}
          >
            Daily
          </button>
          <button
            type="button"
            className={dateMode === "overall" ? "leaderboard-mode-btn is-active" : "leaderboard-mode-btn"}
            onClick={() => setDateMode("overall")}
          >
            Overall
          </button>
        </div>

        {dateMode === "daily" && (
          <input
            type="date"
            className="leaderboard-date-input"
            value={selectedDate}
            max={today}
            onChange={(event) => setSelectedDate(event.target.value)}
          />
        )}
      </div>

      {loading && <p className="leaderboard-status">Loading...</p>}
      {error && <p className="leaderboard-status leaderboard-error">Error: {error}</p>}

      {!loading && !error && (
        <>
          <p className="tile-history-meta">Ranked by total historical minutes inside each named area.</p>
          {data?.items.length ? (
            <table className="leaderboard-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Area</th>
                  <th>Time Spent</th>
                  <th>Samples</th>
                  <th>Tiles</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((entry) => (
                  <tr key={entry.area_id}>
                    <td className="leaderboard-rank">{entry.rank}</td>
                    <td>{entry.area_name}</td>
                    <td className="leaderboard-value">{formatMinutes(entry.minutes_spent)}</td>
                    <td className="leaderboard-value">{entry.samples}</td>
                    <td className="leaderboard-value">{entry.tiles_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="leaderboard-empty">No historical area dwell data yet.</p>
          )}
        </>
      )}
    </section>
  );
}
