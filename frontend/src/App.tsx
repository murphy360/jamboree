import { useEffect, useState } from "react";
import { useSystemStatus } from "./hooks/useSystemStatus";
import { useTileHistory } from "./hooks/useTileHistory";
import { useTileLocations, type TileLocation } from "./hooks/useTileLocations";
import { LiveMap } from "./components/LiveMap";

const _host = typeof window !== "undefined" ? window.location.hostname : "localhost";
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? `http://${_host}:18000`;
const WS_URL = import.meta.env.VITE_WS_URL ?? `ws://${_host}:18000/ws/locations`;
const BREADCRUMB_OPTIONS = [10, 25, 50, 100];
const DEFAULT_ORANGE_AFTER_MINUTES = 60;
const DEFAULT_RED_AFTER_MINUTES = 360;

type AgeBandConfig = {
  orangeAfterMinutes: number;
  redAfterMinutes: number;
};

type TileListEntry = {
  tile: TileLocation;
  ageMs: number;
  ageLabel: string;
  color: string;
};

function getTileTimestamp(tile: TileLocation): string | null | undefined {
  return tile.tile_service_observed_at ?? tile.observed_at ?? tile.polled_at;
}

function getTileAgeMs(value: string | null | undefined, referenceTimeMs: number): number {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }

  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, referenceTimeMs - timestamp);
}

function getTileColor(ageMs: number, config: AgeBandConfig): string {
  if (!Number.isFinite(ageMs)) {
    return "#dc2626";
  }

  const ageMinutes = Math.floor(ageMs / 60_000);
  if (ageMinutes >= config.redAfterMinutes) {
    return "#dc2626";
  }

  if (ageMinutes >= config.orangeAfterMinutes) {
    return "#f97316";
  }

  return "#2563eb";
}

function formatAge(value: string | null | undefined, referenceTimeMs: number): string {
  if (!value) {
    return "Unknown";
  }

  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return "Unknown";
  }

  const elapsedMs = referenceTimeMs - timestamp;
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

function formatCompactAge(value: string | null | undefined, referenceTimeMs: number): string {
  if (!value) {
    return "Unknown";
  }

  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return "Unknown";
  }

  const ageMs = referenceTimeMs - timestamp;
  if (ageMs < 60_000) {
    return "Now";
  }

  const totalMinutes = Math.floor(ageMs / 60_000);
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) {
    return `${totalHours}hr`;
  }

  const totalDays = Math.floor(totalHours / 24);
  return `${totalDays}d`;
}

export function App() {
  const { locations, connected } = useTileLocations(WS_URL);
  const { backendConnected, homeAssistantConnected, tileCount } = useSystemStatus(BACKEND_URL);
  const [selectedTileUuid, setSelectedTileUuid] = useState<string | null>(null);
  const [breadcrumbLimit, setBreadcrumbLimit] = useState(10);
  const [orangeAfterMinutes, setOrangeAfterMinutes] = useState(DEFAULT_ORANGE_AFTER_MINUTES);
  const [redAfterMinutes, setRedAfterMinutes] = useState(DEFAULT_RED_AFTER_MINUTES);
  const [currentTimeMs, setCurrentTimeMs] = useState(() => Date.now());
  const selectedTile = locations.find((item) => item.tile_uuid === selectedTileUuid) ?? null;
  const { history, loading } = useTileHistory(BACKEND_URL, selectedTileUuid);
  const displayedHistory = history.slice(-breadcrumbLimit).reverse();
  const ageBandConfig: AgeBandConfig = {
    orangeAfterMinutes,
    redAfterMinutes,
  };
  const sortedTiles: TileListEntry[] = [...locations]
    .map((tile) => {
      const timestamp = getTileTimestamp(tile);
      const ageMs = getTileAgeMs(timestamp, currentTimeMs);
      return {
        tile,
        ageMs,
        ageLabel: formatCompactAge(timestamp, currentTimeMs),
        color: getTileColor(ageMs, ageBandConfig),
      };
    })
    .sort((a, b) => {
      if (a.ageMs !== b.ageMs) {
        return b.ageMs - a.ageMs;
      }

      return a.tile.label.localeCompare(b.tile.label);
    });
  const tileColorByUuid = sortedTiles.reduce<Record<string, string>>((acc, entry) => {
    acc[entry.tile.tile_uuid] = entry.color;
    return acc;
  }, {});
  // Color for historical breadcrumbs (teal for live, orange for history)
  const breadcrumbColor = "#f59e42"; // orange-400

  useEffect(() => {
    if (selectedTileUuid && !selectedTile) {
      setSelectedTileUuid(null);
    }
  }, [selectedTile, selectedTileUuid]);

  useEffect(() => {
    const ticker = setInterval(() => {
      setCurrentTimeMs(Date.now());
    }, 60_000);

    return () => {
      clearInterval(ticker);
    };
  }, []);

  const handleTileClick = (tile: TileLocation) => {
    setSelectedTileUuid(tile.tile_uuid);
    setBreadcrumbLimit(10);
  };

  const handleMapClick = () => {
    setSelectedTileUuid(null);
  };

  const handleOrangeAfterMinutesChange = (value: number) => {
    const safeOrange = Number.isFinite(value) ? Math.max(1, value) : DEFAULT_ORANGE_AFTER_MINUTES;
    setOrangeAfterMinutes(safeOrange);
    if (redAfterMinutes <= safeOrange) {
      setRedAfterMinutes(safeOrange + 1);
    }
  };

  const handleRedAfterMinutesChange = (value: number) => {
    const safeRed = Number.isFinite(value)
      ? Math.max(orangeAfterMinutes + 1, value)
      : Math.max(orangeAfterMinutes + 1, DEFAULT_RED_AFTER_MINUTES);
    setRedAfterMinutes(safeRed);
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
        tileColorByUuid={tileColorByUuid}
      />

      <details className="tile-list-panel" open>
        <summary>Tracked Tiles</summary>
        <div className="tile-list-config">
          <label htmlFor="orange-after-minutes">
            Orange after (minutes)
            <input
              id="orange-after-minutes"
              type="number"
              min={1}
              value={orangeAfterMinutes}
              onChange={(event) => handleOrangeAfterMinutesChange(Number(event.target.value))}
            />
          </label>
          <label htmlFor="red-after-minutes">
            Red after (minutes)
            <input
              id="red-after-minutes"
              type="number"
              min={orangeAfterMinutes + 1}
              value={redAfterMinutes}
              onChange={(event) => handleRedAfterMinutesChange(Number(event.target.value))}
            />
          </label>
        </div>
        {sortedTiles.length === 0 ? (
          <p className="tile-list-empty">No tile positions received yet.</p>
        ) : (
          <ul className="tile-list">
            {sortedTiles.map((entry, index) => {
              const tile = entry.tile;

              return (
                <li key={tile.tile_uuid} className="tile-list-item">
                  <button
                    type="button"
                    className={tile.tile_uuid === selectedTileUuid ? "tile-list-button is-active" : "tile-list-button"}
                    style={{ borderLeftColor: entry.color }}
                    onClick={() => handleTileClick(tile)}
                  >
                    <div className="tile-list-row">
                      <h3>
                        <span className="tile-list-rank">#{index + 1}.</span> {tile.label}
                      </h3>
                      <p className="tile-list-age">{entry.ageLabel}</p>
                    </div>
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
            {selectedTile ? (
              <p className="tile-history-meta">Position Age: {formatAge(getTileTimestamp(selectedTile), currentTimeMs)}</p>
            ) : null}
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
