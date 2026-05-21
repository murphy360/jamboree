import { useState } from "react";
import { useLeaderboard, type LeaderboardEntry } from "../hooks/useLeaderboard";

type LeaderboardPanelProps = {
  backendUrl: string;
};

type MetricTab = "distance" | "camp_time";

function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}

function formatCampTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function LeaderboardTable({
  entries,
  metric,
}: {
  entries: LeaderboardEntry[];
  metric: MetricTab;
}) {
  if (entries.length === 0) {
    return <p className="leaderboard-empty">No data yet.</p>;
  }

  return (
    <table className="leaderboard-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Name</th>
          <th>{metric === "distance" ? "Distance" : "Time in Camp"}</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={entry.tile_uuid}>
            <td className="leaderboard-rank">{entry.rank}</td>
            <td>{entry.label}</td>
            <td className="leaderboard-value">
              {metric === "distance"
                ? formatDistance(entry.value)
                : formatCampTime(entry.value)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function LeaderboardPanel({ backendUrl }: LeaderboardPanelProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [dateMode, setDateMode] = useState<"daily" | "overall">("daily");
  const [selectedDate, setSelectedDate] = useState<string>(today);
  const [activeTab, setActiveTab] = useState<MetricTab>("distance");

  const queryDate = dateMode === "daily" ? selectedDate : null;
  const { data, loading, error, refresh } = useLeaderboard(backendUrl, queryDate);

  const entries = data ? (activeTab === "distance" ? data.distance : data.camp_time) : [];

  return (
    <div className="leaderboard-panel">
      <div className="leaderboard-header">
        <h2>Leaderboard</h2>
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
            onChange={(e) => setSelectedDate(e.target.value)}
          />
        )}
      </div>

      <div className="leaderboard-tabs">
        <button
          type="button"
          className={activeTab === "distance" ? "leaderboard-tab is-active" : "leaderboard-tab"}
          onClick={() => setActiveTab("distance")}
        >
          Most Distance
        </button>
        <button
          type="button"
          className={activeTab === "camp_time" ? "leaderboard-tab is-active" : "leaderboard-tab"}
          onClick={() => setActiveTab("camp_time")}
        >
          Most Time in Camp
        </button>
      </div>

      {loading && <p className="leaderboard-status">Loading...</p>}
      {error && <p className="leaderboard-status leaderboard-error">Error: {error}</p>}
      {!loading && !error && <LeaderboardTable entries={entries} metric={activeTab} />}
    </div>
  );
}
