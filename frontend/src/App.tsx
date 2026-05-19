import { useEffect, useState } from "react";
import { useSystemStatus } from "./hooks/useSystemStatus";
import { useTileHistory } from "./hooks/useTileHistory";
import { useTileLocations, type TileLocation } from "./hooks/useTileLocations";
import { LiveMap } from "./components/LiveMap";

const _host = typeof window !== "undefined" ? window.location.hostname : "localhost";
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? `http://${_host}:18000`;
const WS_URL = import.meta.env.VITE_WS_URL ?? `ws://${_host}:18000/ws/locations`;
const BREADCRUMB_OPTIONS = [10, 25, 50, 100];

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "Unknown";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `${date.toLocaleString()} (${zone})`;
}

function formatAge(value: string | null | undefined): string {
  if (!value) {
    return "Unknown";
  }

  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return "Unknown";
  }

  const elapsedMs = Date.now() - timestamp;
  if (elapsedMs <= -60_000) {
    const futureMinutes = Math.floor(Math.abs(elapsedMs) / 60_000);
    if (futureMinutes < 60) {
      return `In ${futureMinutes} min`;
    }

    const futureHours = Math.floor(futureMinutes / 60);
    const remMinutes = futureMinutes % 60;
    return remMinutes > 0 ? `In ${futureHours} hr ${remMinutes} min` : `In ${futureHours} hr`;
  }

  if (Math.abs(elapsedMs) < 60_000) {
    return "Just now";
  }

  const totalMinutes = Math.floor(elapsedMs / 60_000);
  if (totalMinutes < 60) {
    return `${totalMinutes} min ago`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours < 24) {
    return minutes > 0 ? `${hours} hr ${minutes} min ago` : `${hours} hr ago`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days} d ${remainingHours} hr ago` : `${days} d ago`;
}

export function App() {
  const { locations, connected } = useTileLocations(WS_URL);
  const { backendConnected, homeAssistantConnected, tileCount } = useSystemStatus(BACKEND_URL);
  const [selectedTileUuid, setSelectedTileUuid] = useState<string | null>(null);
  const [breadcrumbLimit, setBreadcrumbLimit] = useState(10);
  const selectedTile = locations.find((item) => item.tile_uuid === selectedTileUuid) ?? null;
  const { history, loading } = useTileHistory(BACKEND_URL, selectedTileUuid);
  const sortedTiles = [...locations].sort((a, b) => a.label.localeCompare(b.label));
  const displayedHistory = history.slice(-breadcrumbLimit).reverse();
  // Color for historical breadcrumbs (teal for live, orange for history)
  const breadcrumbColor = "#f59e42"; // orange-400

  useEffect(() => {
    if (selectedTileUuid && !selectedTile) {
      setSelectedTileUuid(null);
    }
  }, [selectedTile, selectedTileUuid]);

  const handleTileClick = (tile: TileLocation) => {
    setSelectedTileUuid(tile.tile_uuid);
    setBreadcrumbLimit(10);
  };

  const handleMapClick = () => {
    setSelectedTileUuid(null);
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
      </header>

      <LiveMap
        locations={locations}
        selectedTileUuid={selectedTileUuid}
        onTileClick={handleTileClick}
        onMapClick={handleMapClick}
        breadcrumbs={displayedHistory}
        breadcrumbColor={breadcrumbColor}
      />

      <details className="tile-list-panel" open>
        <summary>Tracked Tiles</summary>
        {sortedTiles.length === 0 ? (
          <p className="tile-list-empty">No tile positions received yet.</p>
        ) : (
          <ul className="tile-list">
            {sortedTiles.map((tile) => {
              const tileServiceTimestamp = tile.tile_service_observed_at;

              return (
                <li key={tile.tile_uuid} className="tile-list-item">
                  <button
                    type="button"
                    className={tile.tile_uuid === selectedTileUuid ? "tile-list-button is-active" : "tile-list-button"}
                    onClick={() => handleTileClick(tile)}
                  >
                    <h3>{tile.label}</h3>
                    <p>ID: {tile.tile_uuid}</p>
                    <p>
                      Lat/Lng: {tile.latitude.toFixed(5)}, {tile.longitude.toFixed(5)}
                    </p>
                    <p>Tile Service Update: {formatTimestamp(tileServiceTimestamp)}</p>
                    <p>Position Age: {formatAge(tileServiceTimestamp)}</p>
                    <p>Last HA Poll: {formatTimestamp(tile.polled_at)}</p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </details>

      <section className="tile-history-panel">
        <div className="tile-history-header">
          <div>
            <p className="tile-history-kicker">Tile history</p>
            <h2>{selectedTile ? selectedTile.label : "Select a tile on the map"}</h2>
          </div>
          {selectedTile ? (
            <div className="tile-history-toolbar">
              <label className="tile-history-selector" htmlFor="breadcrumb-limit">
                <span>Breadcrumbs</span>
                <select
                  id="breadcrumb-limit"
                  value={breadcrumbLimit}
                  onChange={(event) => setBreadcrumbLimit(Number(event.target.value))}
                >
                  {BREADCRUMB_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <p className="tile-history-meta">{selectedTile.tile_uuid}</p>
            </div>
          ) : null}
        </div>

        {!selectedTile ? (
          <p className="tile-list-empty">Click a tile marker or list item to inspect its path.</p>
        ) : loading ? (
          <p className="tile-list-empty">Loading history...</p>
        ) : history.length === 0 ? (
          <p className="tile-list-empty">No stored history for this tile yet.</p>
        ) : (
          <>
            <p className="tile-history-count">
              Showing {displayedHistory.length} of {history.length} stored breadcrumbs.
            </p>
            <ol className="tile-history-list">
              {displayedHistory.map((point) => (
              <li key={`${point.tile_uuid}-${point.observed_at}`} className="tile-history-item">
                <strong>{new Date(point.observed_at).toLocaleString()}</strong>
                <span>
                  {point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}
                </span>
              </li>
              ))}
            </ol>
          </>
        )}
      </section>

      {/* Removed duplicate LiveMap */}
    </main>
  );
}
