import { useCallback, useEffect, useMemo, useState } from "react";
import { useTileHistory } from "../hooks/useTileHistory";
import { useCustomAreas } from "../hooks/useCustomAreas";
import type { TileLocation } from "../hooks/useTileLocations";
import type { AreaPolygonPoint } from "../hooks/useTileDetails";
import {
  buildSortedTileEntries,
  buildTileColorMap,
  formatAge,
  getAgeBandConfig,
  getTileTimestamp,
  type TileListEntry,
} from "../utils/tileAge";
import { LiveMap } from "./LiveMap";

type LiveTrackerViewProps = {
  backendUrl: string;
  locations: TileLocation[];
  onOpenDetails: (tileUuid: string) => void;
};

type LiveTrackerState = {
  selectedTileUuid: string | null;
  selectedTile: TileLocation | null;
  breadcrumbLimit: number;
  currentTimeMs: number;
  mapResetSignal: number;
  history: TileLocation[];
  loading: boolean;
  sortedTiles: TileListEntry[];
  tileColorByUuid: Record<string, string>;
  displayedHistory: TileLocation[];
  onSelectTile: (tile: TileLocation) => void;
  onClearSelection: () => void;
  onResetMapView: () => void;
  setBreadcrumbLimit: (value: number) => void;
};

const BREADCRUMB_OPTIONS = [10, 25, 50, 100];
const BREADCRUMB_COLOR = "#f59e42";

function TrackedTileList({
  entries,
  selectedTileUuid,
  onTileClick,
  onOpenDetails,
}: {
  entries: TileListEntry[];
  selectedTileUuid: string | null;
  onTileClick: (tile: TileLocation) => void;
  onOpenDetails: (tileUuid: string) => void;
}) {
  if (entries.length === 0) {
    return <p className="tile-list-empty">No tile positions received yet.</p>;
  }

  return (
    <ul className="tile-list">
      {entries.map((entry, index) => {
        const tile = entry.tile;

        return (
          <li key={tile.tile_uuid} className="tile-list-item">
            <div className="tile-list-item-row">
              <button
                type="button"
                className={tile.tile_uuid === selectedTileUuid ? "tile-list-button is-active" : "tile-list-button"}
                style={{ borderLeftColor: entry.color }}
                onClick={() => onTileClick(tile)}
              >
                <div className="tile-list-row">
                  <h3>
                    <span className="tile-list-rank">#{index + 1}.</span> {tile.label}
                  </h3>
                  <p className="tile-list-age">{entry.ageLabel}</p>
                </div>
              </button>
              <button
                type="button"
                className="tile-list-details-button"
                onClick={() => onOpenDetails(tile.tile_uuid)}
              >
                Details
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function TileHistoryPanel({
  selectedTile,
  history,
  loading,
  breadcrumbLimit,
  setBreadcrumbLimit,
  currentTimeMs,
}: {
  selectedTile: TileLocation | null;
  history: TileLocation[];
  loading: boolean;
  breadcrumbLimit: number;
  setBreadcrumbLimit: (value: number) => void;
  currentTimeMs: number;
}) {
  const displayedHistory = history.slice(-breadcrumbLimit).reverse();

  return (
    <section className="tile-history-panel">
      <HistoryHeader
        selectedTile={selectedTile}
        currentTimeMs={currentTimeMs}
        breadcrumbLimit={breadcrumbLimit}
        setBreadcrumbLimit={setBreadcrumbLimit}
      />

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
  );
}

function HistoryHeader({
  selectedTile,
  currentTimeMs,
  breadcrumbLimit,
  setBreadcrumbLimit,
}: {
  selectedTile: TileLocation | null;
  currentTimeMs: number;
  breadcrumbLimit: number;
  setBreadcrumbLimit: (value: number) => void;
}) {
  return (
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
            <select id="breadcrumb-limit" value={breadcrumbLimit} onChange={(event) => setBreadcrumbLimit(Number(event.target.value))}>
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
  );
}

export function LiveTrackerView({ backendUrl, locations, onOpenDetails }: LiveTrackerViewProps) {
  const state = useLiveTrackerState(backendUrl, locations);
  const areaApiTileUuid = state.selectedTileUuid ?? locations[0]?.tile_uuid ?? "global";
  const { createArea } = useCustomAreas({
    baseUrl: backendUrl,
    tileUuid: areaApiTileUuid,
    onRefresh: () => {
      // No explicit refresh action needed on the live map panel.
    },
  });

  const handleDrawPolygon = useCallback(
    async (points: AreaPolygonPoint[]) => {
      if (points.length < 3) {
        window.alert("A polygon needs at least 3 points.");
        return;
      }

      const suggestedName = state.selectedTile ? `${state.selectedTile.label} Area` : "Custom Area";
      const input = window.prompt("Name this area:", suggestedName);
      const name = input?.trim();
      if (!name) {
        return;
      }

      try {
        await createArea(name, points);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to create area.";
        window.alert(message);
      }
    },
    [createArea, state.selectedTile, state.selectedTileUuid],
  );

  return (
    <>
      <section className="map-panel">
        <div className="map-toolbar">
          <button
            type="button"
            className="map-reset-button"
            onClick={state.onResetMapView}
            disabled={locations.length === 0}
          >
            Reset View
          </button>
        </div>
        <LiveMap
          locations={locations}
          selectedTileUuid={state.selectedTileUuid}
          onTileClick={state.onSelectTile}
          onMapClick={state.onClearSelection}
          onDrawPolygon={handleDrawPolygon}
          breadcrumbs={state.displayedHistory}
          breadcrumbColor={BREADCRUMB_COLOR}
          tileColorByUuid={state.tileColorByUuid}
          fitSignal={state.mapResetSignal}
        />
      </section>

      <details className="tile-list-panel" open>
        <summary>Tracked Tiles</summary>
        <TrackedTileList
          entries={state.sortedTiles}
          selectedTileUuid={state.selectedTileUuid}
          onTileClick={state.onSelectTile}
          onOpenDetails={onOpenDetails}
        />
      </details>

      <TileHistoryPanel
        selectedTile={state.selectedTile}
        history={state.history}
        loading={state.loading}
        breadcrumbLimit={state.breadcrumbLimit}
        setBreadcrumbLimit={state.setBreadcrumbLimit}
        currentTimeMs={state.currentTimeMs}
      />
    </>
  );
}

function useLiveTrackerState(backendUrl: string, locations: TileLocation[]): LiveTrackerState {
  const [selectedTileUuid, setSelectedTileUuid] = useState<string | null>(null);
  const [breadcrumbLimit, setBreadcrumbLimit] = useState(10);
  const [mapResetSignal, setMapResetSignal] = useState(0);
  const [currentTimeMs, setCurrentTimeMs] = useState(() => Date.now());
  const selectedTile = locations.find((item) => item.tile_uuid === selectedTileUuid) ?? null;
  const { history, loading } = useTileHistory(backendUrl, selectedTileUuid);
  const ageBandConfig = useMemo(() => getAgeBandConfig(), []);
  const sortedTiles = useMemo(
    () => buildSortedTileEntries(locations, currentTimeMs, ageBandConfig),
    [ageBandConfig, currentTimeMs, locations],
  );
  const tileColorByUuid = useMemo(() => buildTileColorMap(sortedTiles), [sortedTiles]);
  const displayedHistory = history.slice(-breadcrumbLimit).reverse();

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

  return {
    selectedTileUuid,
    selectedTile,
    breadcrumbLimit,
    currentTimeMs,
    mapResetSignal,
    history,
    loading,
    sortedTiles,
    tileColorByUuid,
    displayedHistory,
    onSelectTile: (tile) => {
      setSelectedTileUuid(tile.tile_uuid);
      setBreadcrumbLimit(10);
    },
    onClearSelection: () => setSelectedTileUuid(null),
    onResetMapView: () => setMapResetSignal((value) => value + 1),
    setBreadcrumbLimit,
  };
}
