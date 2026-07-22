import { useCallback, useEffect, useMemo, useState } from "react";
import { useTileHistory } from "../hooks/useTileHistory";
import { useCustomAreas } from "../hooks/useCustomAreas";
import { useMapFeatures } from "../hooks/useMapFeatures";
import type { TileLocation } from "../hooks/useTileLocations";
import type { AreaPolygonPoint, CustomArea } from "../hooks/useTileDetails";
import {
  buildSortedTileEntries,
  buildTileColorMap,
  formatAge,
  getAgeBandConfig,
  getTileTimestamp,
  type TileListEntry,
} from "../utils/tileAge";
import { LiveMap } from "./LiveMap";
import { LeaderboardPanel } from "./LeaderboardPanel";
import { CustomAreasPanel } from "./CustomAreasPanel";
import { TopHotspotsPanel } from "./TopHotspotsPanel";

type LiveTrackerViewProps = {
  backendUrl: string;
  locations: TileLocation[];
  onOpenDetails: (tileUuid: string) => void;
  showGisLayers: boolean;
};

type TileListMode = "all" | "areas" | "moving" | "hotspots" | "leaderboard" | "area-editor";

type FocusedHotspot = {
  latitude: number;
  longitude: number;
  label: string;
};

type AreaGroupedTileList = {
  area: CustomArea;
  entries: TileListEntry[];
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

function pointInPolygon(lat: number, lon: number, polygon: AreaPolygonPoint[]): boolean {
  const n = polygon.length;
  if (n < 3) return false;
  const epsilon = 1e-9;

  const pointOnSegment = (
    pointLat: number,
    pointLon: number,
    startLat: number,
    startLon: number,
    endLat: number,
    endLon: number,
  ): boolean => {
    const cross = (pointLat - startLat) * (endLon - startLon) - (pointLon - startLon) * (endLat - startLat);
    if (Math.abs(cross) > epsilon) return false;

    const dot = (pointLat - startLat) * (endLat - startLat) + (pointLon - startLon) * (endLon - startLon);
    if (dot < -epsilon) return false;

    const squaredLen = (endLat - startLat) ** 2 + (endLon - startLon) ** 2;
    return dot <= squaredLen + epsilon;
  };

  let inside = false;
  let j = n - 1;
  for (let i = 0; i < n; i++) {
    const piLat = polygon[i].latitude;
    const piLon = polygon[i].longitude;
    const pjLat = polygon[j].latitude;
    const pjLon = polygon[j].longitude;

    if (pointOnSegment(lat, lon, piLat, piLon, pjLat, pjLon)) return true;

    const lonCrosses = (piLon > lon) !== (pjLon > lon);
    if (lonCrosses) {
      const latIntersect =
        ((pjLat - piLat) * (lon - piLon)) / (pjLon - piLon) +
        piLat;
      if (lat < latIntersect) inside = !inside;
    }
    j = i;
  }
  return inside;
}

function findContainingArea(tile: TileLocation, areas: CustomArea[]): CustomArea | null {
  return areas.find((area) => pointInPolygon(tile.latitude, tile.longitude, area.polygon)) ?? null;
}

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

function TrackedTileAreaGroups({
  groups,
  unassigned,
  selectedTileUuid,
  onTileClick,
  onOpenDetails,
}: {
  groups: AreaGroupedTileList[];
  unassigned: TileListEntry[];
  selectedTileUuid: string | null;
  onTileClick: (tile: TileLocation) => void;
  onOpenDetails: (tileUuid: string) => void;
}) {
  if (groups.length === 0 && unassigned.length === 0) {
    return <p className="tile-list-empty">No tile positions received yet.</p>;
  }

  return (
    <div className="tile-area-groups">
      {groups.map((group) => (
        <section key={group.area.area_id} className="tile-area-group">
          <h3>{group.area.name}</h3>
          <TrackedTileList
            entries={group.entries}
            selectedTileUuid={selectedTileUuid}
            onTileClick={onTileClick}
            onOpenDetails={onOpenDetails}
          />
        </section>
      ))}
      {unassigned.length > 0 ? (
        <section className="tile-area-group">
          <h3>Outside Named Areas</h3>
          <TrackedTileList
            entries={unassigned}
            selectedTileUuid={selectedTileUuid}
            onTileClick={onTileClick}
            onOpenDetails={onOpenDetails}
          />
        </section>
      ) : null}
    </div>
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

function CollapsibleAreaSorting({
  groups,
  onToggle,
}: {
  groups: AreaGroupedTileList[];
  onToggle: (areaId: string) => void;
}) {
  return (
    <div className="collapsible-area-sorting">
      {groups.map((group) => (
        <div key={group.area.area_id} className="area-group">
          <button
            type="button"
            className="area-group-toggle"
            onClick={() => onToggle(group.area.area_id)}
          >
            {group.area.name} ({group.entries.length})
          </button>
        </div>
      ))}
    </div>
  );
}

export function LiveTrackerView({ backendUrl, locations, onOpenDetails, showGisLayers }: LiveTrackerViewProps) {
  const [tileListMode, setTileListMode] = useState<TileListMode>("all");
  const [collapsedAreas, setCollapsedAreas] = useState<Record<string, boolean>>({});
  const [showNamedPoints, setShowNamedPoints] = useState(true);
  const [focusedHotspot, setFocusedHotspot] = useState<FocusedHotspot | null>(null);
  const [focusSignal, setFocusSignal] = useState(0);
  const currentTimeMs = Date.now();

  const toggleAreaCollapse = (areaId: string) => {
    setCollapsedAreas((prev) => ({
      ...prev,
      [areaId]: !prev[areaId],
    }));
  };

  const { areas, createArea, renameArea, deleteArea } = useCustomAreas({
    baseUrl: backendUrl,
    tileUuid: "global", // Placeholder UUID to fetch global areas
    onRefresh: () => {},
  });
  const { points: importedPoints } = useMapFeatures(backendUrl, "global");

  const handleDrawPolygon = useCallback(
    async (points: AreaPolygonPoint[]) => {
      const requestedName = window.prompt("Name this area");
      const name = requestedName?.trim();
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
    [createArea],
  );

  // Build sorted tile entries for "All Tiles" tab
  const sortedTiles = useMemo(
    () => buildSortedTileEntries(locations, currentTimeMs, getAgeBandConfig()),
    [locations, currentTimeMs]
  );

  // Build tile color map
  const tileColorByUuid = useMemo(() => buildTileColorMap(sortedTiles), [sortedTiles]);

  // Group tiles by area
  const groupedTiles = useMemo(() => {
    const groups: AreaGroupedTileList[] = areas.map((area) => {
      const entriesInArea = sortedTiles.filter((entry) =>
        pointInPolygon(entry.tile.latitude, entry.tile.longitude, area.polygon)
      );
      return {
        area,
        entries: entriesInArea,
      };
    });

    // Find tiles that are in any area
    const tilesInAreas = new Set(
      groups.flatMap((g) => g.entries.map((e) => e.tile.tile_uuid))
    );

    // Tiles not in any area
    const unassigned = sortedTiles.filter(
      (entry) => !tilesInAreas.has(entry.tile.tile_uuid)
    );

    return { groups, unassigned };
  }, [sortedTiles, areas]);

  const areaEditorPoints = tileListMode === "area-editor" && showNamedPoints ? importedPoints : [];

  const handleSelectTopHotspot = useCallback((hotspot: FocusedHotspot) => {
    setFocusedHotspot(hotspot);
    setFocusSignal((value) => value + 1);
  }, []);

  return (
    <div className="live-tracker-view">
      <LiveMap
        locations={locations}
        areas={areas}
        selectedTileUuid={null}
        onTileClick={() => {}}
        onMapClick={() => {}}
        onDrawPolygon={tileListMode === "area-editor" ? handleDrawPolygon : undefined}
        showGisLayers={showGisLayers}
        importedPoints={areaEditorPoints}
        focusedHotspot={focusedHotspot}
        focusSignal={focusSignal}
      />

      <div className="tabs">
        <button
          className={tileListMode === "all" ? "is-active" : ""}
          onClick={() => setTileListMode("all")}
        >
          All Tiles
        </button>
        <button
          className={tileListMode === "areas" ? "is-active" : ""}
          onClick={() => setTileListMode("areas")}
        >
          By Area
        </button>
        <button
          className={tileListMode === "moving" ? "is-active" : ""}
          onClick={() => setTileListMode("moving")}
        >
          Moving
        </button>
        <button
          className={tileListMode === "hotspots" ? "is-active" : ""}
          onClick={() => setTileListMode("hotspots")}
        >
          Top Hotspots
        </button>
        <button
          className={tileListMode === "leaderboard" ? "is-active" : ""}
          onClick={() => setTileListMode("leaderboard")}
        >
          Leaderboard
        </button>
        <button
          className={tileListMode === "area-editor" ? "is-active" : ""}
          onClick={() => setTileListMode("area-editor")}
        >
          Area Editor
        </button>
      </div>

      {tileListMode === "all" && (
        <TrackedTileList
          entries={sortedTiles}
          selectedTileUuid={null}
          onTileClick={() => {}}
          onOpenDetails={onOpenDetails}
        />
      )}

      {tileListMode === "areas" && (
        <TrackedTileAreaGroups
          groups={groupedTiles.groups}
          unassigned={groupedTiles.unassigned}
          selectedTileUuid={null}
          onTileClick={() => {}}
          onOpenDetails={onOpenDetails}
        />
      )}

      {tileListMode === "moving" && (
        <TrackedTileList
          entries={groupedTiles.unassigned}
          selectedTileUuid={null}
          onTileClick={() => {}}
          onOpenDetails={onOpenDetails}
        />
      )}

      {tileListMode === "hotspots" && (
        <TopHotspotsPanel
          backendUrl={backendUrl}
          locations={locations}
          onSelectHotspot={handleSelectTopHotspot}
        />
      )}

      {tileListMode === "leaderboard" && <LeaderboardPanel backendUrl={backendUrl} />}

      {tileListMode === "area-editor" && (
        <section className="tile-details-panel">
          <h3 className="tile-details-subtitle">Area Editor</h3>
          <p className="tile-list-empty">
            Draw a polygon directly on the map to create an area. Rename or delete existing areas below.
          </p>
          <label className="area-editor-toggle">
            <input
              type="checkbox"
              checked={showNamedPoints}
              onChange={(event) => setShowNamedPoints(event.target.checked)}
            />
            <span>Show imported points with human-readable names ({importedPoints.length})</span>
          </label>
          <CustomAreasPanel areas={areas} onRename={renameArea} onDelete={deleteArea} />
        </section>
      )}
    </div>
  );
}
