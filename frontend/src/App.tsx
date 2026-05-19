import { useEffect, useState } from "react";
import { useSystemStatus } from "./hooks/useSystemStatus";
import { useTileHistory } from "./hooks/useTileHistory";
import { useTileLocations, type TileLocation } from "./hooks/useTileLocations";
import { LiveMap } from "./components/LiveMap";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:18000";
const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:18000/ws/locations";

export function App() {
  const { locations, connected } = useTileLocations(WS_URL);
  const { backendConnected, homeAssistantConnected, tileCount } = useSystemStatus(BACKEND_URL);
  const [selectedTileUuid, setSelectedTileUuid] = useState<string | null>(null);
  const selectedTile = locations.find((item) => item.tile_uuid === selectedTileUuid) ?? null;
  const { history, loading } = useTileHistory(BACKEND_URL, selectedTileUuid);
  const sortedTiles = [...locations].sort((a, b) => a.label.localeCompare(b.label));

  useEffect(() => {
    if (selectedTileUuid && !selectedTile) {
      setSelectedTileUuid(null);
    }
  }, [selectedTile, selectedTileUuid]);

  const handleTileClick = (tile: TileLocation) => {
    setSelectedTileUuid(tile.tile_uuid);
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

      <details className="tile-list-panel" open>
        <summary>Tracked Tiles</summary>
        {sortedTiles.length === 0 ? (
          <p className="tile-list-empty">No tile positions received yet.</p>
        ) : (
          <ul className="tile-list">
            {sortedTiles.map((tile) => (
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
                  <p>Updated: {new Date(tile.observed_at).toLocaleString()}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </details>

      <section className="tile-history-panel">
        <div className="tile-history-header">
          <div>
            <p className="tile-history-kicker">Tile history</p>
            <h2>{selectedTile ? selectedTile.label : "Select a tile on the map"}</h2>
          </div>
          {selectedTile ? <p className="tile-history-meta">{selectedTile.tile_uuid}</p> : null}
        </div>

        {!selectedTile ? (
          <p className="tile-list-empty">Click a tile marker or list item to inspect its path.</p>
        ) : loading ? (
          <p className="tile-list-empty">Loading history...</p>
        ) : history.length === 0 ? (
          <p className="tile-list-empty">No stored history for this tile yet.</p>
        ) : (
          <ol className="tile-history-list">
            {history.map((point) => (
              <li key={`${point.tile_uuid}-${point.observed_at}`} className="tile-history-item">
                <strong>{new Date(point.observed_at).toLocaleString()}</strong>
                <span>
                  {point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <LiveMap
        locations={locations}
        selectedTileUuid={selectedTileUuid}
        onTileClick={handleTileClick}
        onMapClick={handleMapClick}
      />
    </main>
  );
}
