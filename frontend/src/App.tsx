import { useCallback, useState } from "react";
import { LiveTrackerView } from "./components/LiveTrackerView";
import { LeaderboardPanel } from "./components/LeaderboardPanel";
import { useSystemStatus } from "./hooks/useSystemStatus";
import { useTileDetails } from "./hooks/useTileDetails";
import { useTileLocations } from "./hooks/useTileLocations";
import { TileDetailsPage } from "./components/TileDetailsPage";

const _host = typeof window !== "undefined" ? window.location.hostname : "localhost";
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? `http://${_host}:8086`;
const WS_URL = import.meta.env.VITE_WS_URL ?? `ws://${_host}:8086/ws/locations`;

export function App() {
  const { locations, connected } = useTileLocations(WS_URL);
  const { backendConnected, homeAssistantConnected, tileCount } = useSystemStatus(BACKEND_URL);
  const [detailsTileUuid, setDetailsTileUuid] = useState<string | null>(null);
  const [detailsRefreshKey, setDetailsRefreshKey] = useState(0);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const { details, loading: detailsLoading } = useTileDetails(BACKEND_URL, detailsTileUuid, detailsRefreshKey);
  const handleRefreshDetails = useCallback(() => setDetailsRefreshKey((k) => k + 1), []);

  const handleOpenDetails = (tileUuid: string) => {
    setDetailsTileUuid(tileUuid);
  };

  const handleCloseDetails = () => {
    setDetailsTileUuid(null);
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <h1>Jamboree Live Tracker</h1>
        <p>
          Backend Connected: <strong>{backendConnected ? "Yes" : "No"}</strong>
        </p>
        <p>
          Home Assistant Connected: <strong>{homeAssistantConnected ? "Yes" : "No"}</strong>
        </p>
        <p>
          WebSocket Connected: <strong>{connected ? "Yes" : "No"}</strong>
        </p>
        <p>
          Active Tiles: <strong>{tileCount || locations.length}</strong>
        </p>
        <nav className="app-nav">
          <button
            type="button"
            className={showLeaderboard ? "app-nav-btn is-active" : "app-nav-btn"}
            onClick={() => { setShowLeaderboard((v) => !v); setDetailsTileUuid(null); }}
          >
            Leaderboard
          </button>
        </nav>
      </header>

      {showLeaderboard ? (
        <LeaderboardPanel backendUrl={BACKEND_URL} />
      ) : detailsTileUuid ? (
        <TileDetailsPage
          details={details}
          loading={detailsLoading}
          onBack={handleCloseDetails}
          baseUrl={BACKEND_URL}
          tileUuid={detailsTileUuid}
          onRefreshDetails={handleRefreshDetails}
        />
      ) : (
        <LiveTrackerView backendUrl={BACKEND_URL} locations={locations} onOpenDetails={handleOpenDetails} />
      )}
    </main>
  );
}
