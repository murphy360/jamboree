import { useTileLocations } from "./hooks/useTileLocations";
import { LiveMap } from "./components/LiveMap";

const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:8000/ws/locations";

export function App() {
  const { locations, connected } = useTileLocations(WS_URL);

  return (
    <main className="app-shell">
      <header className="app-header">
        <h1>Jamboree Live Tracker</h1>
        <p>
          Connected: <strong>{connected ? "Yes" : "No"}</strong>
        </p>
      </header>
      <LiveMap locations={locations} />
    </main>
  );
}
