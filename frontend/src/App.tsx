import { useCallback, useState } from "react";
import { LiveTrackerView } from "./components/LiveTrackerView";
import { useSystemStatus } from "./hooks/useSystemStatus";
import { useTileDetails } from "./hooks/useTileDetails";
import { useTileLocations } from "./hooks/useTileLocations";
import { TileDetailsPage } from "./components/TileDetailsPage";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? "/api";
const WS_URL =
  import.meta.env.VITE_WS_URL ??
  `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws/locations`;

export function App() {
  const { locations, connected } = useTileLocations(BACKEND_URL, WS_URL);
  const { backendConnected, homeAssistantConnected, tileCount } = useSystemStatus(BACKEND_URL);
  const [detailsTileUuid, setDetailsTileUuid] = useState<string | null>(null);
  const [detailsRefreshKey, setDetailsRefreshKey] = useState(0);
  const [showGisLayers, setShowGisLayers] = useState(true);
  const { details, loading: detailsLoading } = useTileDetails(BACKEND_URL, detailsTileUuid, detailsRefreshKey);
  const handleRefreshDetails = useCallback(() => setDetailsRefreshKey((k) => k + 1), []);

  const handleOpenDetails = (tileUuid: string) => {
    setDetailsTileUuid(tileUuid);
  };

  const handleCloseDetails = () => {
    setDetailsTileUuid(null);
  };

  const handleTrackerRemoved = useCallback(() => {
    setDetailsTileUuid(null);
    setDetailsRefreshKey((k) => k + 1);
  }, []);

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
        <p className="map-layer-toggle-row">
          GIS Layers: <strong>{showGisLayers ? "On" : "Off"}</strong>
          <button
            type="button"
            className="map-layer-toggle"
            onClick={() => setShowGisLayers((current) => !current)}
          >
            {showGisLayers ? "Hide GIS" : "Show GIS"}
          </button>
        </p>
      </header>

      {detailsTileUuid ? (
        <TileDetailsPage
          details={details}
          loading={detailsLoading}
          onBack={handleCloseDetails}
          onTrackerRemoved={handleTrackerRemoved}
          baseUrl={BACKEND_URL}
          tileUuid={detailsTileUuid}
          onRefreshDetails={handleRefreshDetails}
          showGisLayers={showGisLayers}
        />
      ) : (
        <LiveTrackerView
          backendUrl={BACKEND_URL}
          locations={locations}
          onOpenDetails={handleOpenDetails}
          showGisLayers={showGisLayers}
        />
      )}
    </main>
  );
}
