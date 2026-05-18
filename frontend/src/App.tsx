import { useTileLocations } from "./hooks/useTileLocations";
import { useSystemStatus } from "./hooks/useSystemStatus";
import { LiveMap } from "./components/LiveMap";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:18000";
const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:18000/ws/locations";

export function App() {
  const { locations, connected } = useTileLocations(WS_URL);
  const { backendConnected, homeAssistantConnected, tileCount } = useSystemStatus(BACKEND_URL);
  const sortedTiles = [...locations].sort((a, b) => a.label.localeCompare(b.label));

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
                <h3>{tile.label}</h3>
                <p>ID: {tile.tile_uuid}</p>
                <p>
                  Lat/Lng: {tile.latitude.toFixed(5)}, {tile.longitude.toFixed(5)}
                </p>
                <p>Updated: {new Date(tile.observed_at).toLocaleString()}</p>
              </li>
            ))}
          </ul>
        )}
      </details>

      <LiveMap locations={locations} />
    </main>
  );
}
