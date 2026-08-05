import { useCallback, useEffect, useMemo, useState } from "react";
import { DwellHotspotsPanel, type SelectedHotspot } from "./DwellHotspotsPanel";
import { CustomAreasPanel } from "./CustomAreasPanel";
import { TileDetailsMap } from "./TileDetailsMap";
import { useCustomAreas } from "../hooks/useCustomAreas";
import type { TileDetails } from "../hooks/useTileDetails";
import type { TileLocation } from "../hooks/useTileLocations";
import { analyzeDwellHotspots } from "../utils/dwellAnalytics";

type TileDetailsPageProps = {
  details: TileDetails | null;
  loading: boolean;
  onBack: () => void;
  onTrackerRemoved: () => void;
  baseUrl: string;
  tileUuid: string;
  onRefreshDetails: () => void;
  showGisLayers: boolean;
};

type DetailsContentProps = {
  details: TileDetails;
  loading: boolean;
  onBack: () => void;
  onTrackerRemoved: () => void;
  baseUrl: string;
  tileUuid: string;
  onRefreshDetails: () => void;
  showGisLayers: boolean;
};

type CreateAreaOptions = {
  mergeIntoAreaId?: string;
  mergeSourceAreaIds?: string[];
  hotspotCenters?: { latitude: number; longitude: number }[];
};

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown";
  }
  return parsed.toLocaleString();
}

function formatMinutes(value: number): string {
  if (value < 60) {
    return `${value} min`;
  }

  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  if (minutes === 0) {
    return `${hours} hr`;
  }

  return `${hours} hr ${minutes} min`;
}

function observedDateKey(item: TileLocation): string {
  const directMatch = /^(\d{4}-\d{2}-\d{2})/.exec(item.observed_at);
  if (directMatch) {
    return directMatch[1];
  }

  const parsed = new Date(item.observed_at);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toISOString().slice(0, 10);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function toDateTimeLocalValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultRangeForYear(year: number): { start: string; end: string } {
  return {
    start: `${year}-07-22T06:00`,
    end: `${year}-07-31T17:00`,
  };
}

function rangeForDay(day: string): { start: string; end: string } {
  return {
    start: `${day}T00:00`,
    end: `${day}T23:59`,
  };
}

function parseObservedAtMs(value: string): number | null {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

const DEFAULT_DWELL_MERGE_RADIUS_METERS = Number(
  import.meta.env.VITE_DWELL_MERGE_RADIUS_METERS ?? "100",
);

export function TileDetailsPage({ details, loading, onBack, onTrackerRemoved, baseUrl, tileUuid, onRefreshDetails, showGisLayers }: TileDetailsPageProps) {
  if (loading && !details) {
    return (
      <section className="tile-details-panel">
        <button type="button" className="tile-details-back" onClick={onBack}>
          Back to live map
        </button>
        <p className="tile-list-empty">Loading detailed tile history...</p>
      </section>
    );
  }

  if (!details) {
    return (
      <section className="tile-details-panel">
        <button type="button" className="tile-details-back" onClick={onBack}>
          Back to live map
        </button>
        <p className="tile-list-empty">No details are available for that tile yet.</p>
      </section>
    );
  }

  return (
    <DetailsContent
      details={details}
      loading={loading}
      onBack={onBack}
      onTrackerRemoved={onTrackerRemoved}
      baseUrl={baseUrl}
      tileUuid={tileUuid}
      onRefreshDetails={onRefreshDetails}
      showGisLayers={showGisLayers}
    />
  );
}

function DetailsContent({ details, loading, onBack, onTrackerRemoved, baseUrl, tileUuid, onRefreshDetails, showGisLayers }: DetailsContentProps) {
  const [selectedHotspot, setSelectedHotspot] = useState<SelectedHotspot | null>(null);
  const [selectedDay, setSelectedDay] = useState<string>("all");
  const [rangeStart, setRangeStart] = useState<string>("");
  const [rangeEnd, setRangeEnd] = useState<string>("");
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { createArea, renameArea, deleteArea, deleteAreas, mergeAreas, latestMergeUndo, undoMerge } = useCustomAreas({
    baseUrl,
    tileUuid,
    onRefresh: onRefreshDetails,
  });
  const { areas: globalAreas } = useCustomAreas({
    baseUrl,
    tileUuid: "global",
    onRefresh: () => {},
  });

  const handleCreateArea = useCallback(
    (name: string, centers: { latitude: number; longitude: number }[], options?: CreateAreaOptions) => createArea(name, centers, options),
    [createArea],
  );

  useEffect(() => {
    const observedYear = new Date(details.last_observed_at).getFullYear();
    const fallbackYear = Number.isFinite(observedYear) ? observedYear : new Date().getFullYear();
    const defaults = defaultRangeForYear(fallbackYear);

    setSelectedDay("all");
    setRangeStart(defaults.start);
    setRangeEnd(defaults.end);
    setSelectedHotspot(null);
  }, [details.tile_uuid]);

  const availableDays = useMemo(
    () => [...details.daily_breakdown].sort((a, b) => b.date.localeCompare(a.date)),
    [details.daily_breakdown],
  );

  const normalizedRange = useMemo(() => {
    const startMs = rangeStart ? new Date(rangeStart).getTime() : null;
    const endMs = rangeEnd ? new Date(rangeEnd).getTime() : null;

    const hasStart = startMs !== null && Number.isFinite(startMs);
    const hasEnd = endMs !== null && Number.isFinite(endMs);

    if (!hasStart && !hasEnd) {
      return { startMs: null as number | null, endMs: null as number | null };
    }

    if (hasStart && !hasEnd) {
      return { startMs: startMs as number, endMs: null as number | null };
    }

    if (!hasStart && hasEnd) {
      return { startMs: null as number | null, endMs: endMs as number };
    }

    const safeStart = startMs as number;
    const safeEnd = endMs as number;
    return {
      startMs: Math.min(safeStart, safeEnd),
      endMs: Math.max(safeStart, safeEnd),
    };
  }, [rangeEnd, rangeStart]);

  const filteredItems = useMemo(() => {
    return details.items.filter((item) => {
      if (selectedDay !== "all" && observedDateKey(item) !== selectedDay) {
        return false;
      }

      const observedMs = parseObservedAtMs(item.observed_at);
      if (observedMs === null) {
        return false;
      }

      if (normalizedRange.startMs !== null && observedMs < normalizedRange.startMs) {
        return false;
      }

      if (normalizedRange.endMs !== null && observedMs > normalizedRange.endMs) {
        return false;
      }

      return true;
    });
  }, [details.items, normalizedRange.endMs, normalizedRange.startMs, selectedDay]);

  const filteredDwellClusters = useMemo(() => {
    const usingAllDays = selectedDay === "all";
    const usingFullWindow = normalizedRange.startMs === null && normalizedRange.endMs === null;
    if (usingAllDays && usingFullWindow) {
      return details.dwell_clusters;
    }

    if (filteredItems.length === 0) {
      return [];
    }

    const analysis = analyzeDwellHotspots(
      filteredItems,
      "ever",
      filteredItems[filteredItems.length - 1].observed_at,
      DEFAULT_DWELL_MERGE_RADIUS_METERS,
      30,
      details.custom_areas.map((area) => area.polygon),
    );

    return analysis.overall.map((cluster) => ({
      latitude: cluster.latitude,
      longitude: cluster.longitude,
      samples: cluster.samples,
      minutes_spent: cluster.minutesSpent,
    }));
  }, [details.custom_areas, details.dwell_clusters, filteredItems, normalizedRange.endMs, normalizedRange.startMs, selectedDay]);

  const selectedDaySummary = useMemo(
    () => availableDays.find((day) => day.date === selectedDay) ?? null,
    [availableDays, selectedDay],
  );

  const mapOverlayAreas = useMemo(() => {
    const merged = new Map<string, (typeof details.custom_areas)[number]>();

    for (const area of globalAreas) {
      merged.set(`${area.tile_uuid}:${area.area_id}`, area);
    }

    for (const area of details.custom_areas) {
      merged.set(`${area.tile_uuid}:${area.area_id}`, area);
    }

    return [...merged.values()];
  }, [details.custom_areas, globalAreas]);

  const filteredDetails = useMemo((): TileDetails => {
    const usingAllDays = selectedDay === "all";
    const usingFullWindow = normalizedRange.startMs === null && normalizedRange.endMs === null;
    if (usingAllDays && usingFullWindow) {
      return details;
    }

    const first = filteredItems[0];
    const last = filteredItems[filteredItems.length - 1];

    return {
      ...details,
      total_points: filteredItems.length,
      returned_points: filteredItems.length,
      history_truncated: false,
      first_observed_at: first?.observed_at ?? details.first_observed_at,
      last_observed_at: last?.observed_at ?? details.last_observed_at,
      items: filteredItems,
      daily_breakdown: selectedDaySummary ? [selectedDaySummary] : [],
      dwell_clusters: filteredDwellClusters,
    };
  }, [details, filteredDwellClusters, filteredItems, normalizedRange.endMs, normalizedRange.startMs, selectedDay, selectedDaySummary]);

  const hotspotDetails = useMemo(
    () => ({
      ...filteredDetails,
      custom_areas: mapOverlayAreas,
    }),
    [filteredDetails, mapOverlayAreas],
  );

  const selectedPointCount = filteredItems.length;

  const handleDayChange = useCallback((value: string) => {
    setSelectedDay(value);

    if (value === "all") {
      const observedYear = new Date(details.last_observed_at).getFullYear();
      const fallbackYear = Number.isFinite(observedYear) ? observedYear : new Date().getFullYear();
      const defaults = defaultRangeForYear(fallbackYear);
      setRangeStart(defaults.start);
      setRangeEnd(defaults.end);
    } else {
      const dayRange = rangeForDay(value);
      setRangeStart(dayRange.start);
      setRangeEnd(dayRange.end);
    }

    setSelectedHotspot(null);
  }, [details.last_observed_at]);

  const handleRangeStartChange = useCallback((value: string) => {
    setRangeStart(value);
    setSelectedHotspot(null);
  }, []);

  const handleRangeEndChange = useCallback((value: string) => {
    setRangeEnd(value);
    setSelectedHotspot(null);
  }, []);

  const isDefaultWindow = useMemo(() => {
    const observedYear = new Date(details.last_observed_at).getFullYear();
    const fallbackYear = Number.isFinite(observedYear) ? observedYear : new Date().getFullYear();
    const defaults = defaultRangeForYear(fallbackYear);
    return rangeStart === defaults.start && rangeEnd === defaults.end;
  }, [details.last_observed_at, rangeEnd, rangeStart]);

  const handleDeleteTracker = useCallback(async () => {
    const confirmed = window.confirm(
      `Remove tracker \"${details.label}\" and all saved history? This cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }

    setDeletePending(true);
    setDeleteError(null);
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/tiles/${encodeURIComponent(tileUuid)}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { detail?: string };
        throw new Error(payload.detail ?? `Delete failed (${response.status})`);
      }

      onTrackerRemoved();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to remove tracker.";
      setDeleteError(message);
      setDeletePending(false);
    }
  }, [baseUrl, details.label, onTrackerRemoved, tileUuid]);

  return (
    <section className="tile-details-panel">
      <div className="tile-details-header">
        <div>
          <p className="tile-history-kicker">Tile details</p>
          <h2>{details.label}</h2>
          <p className="tile-history-meta">{details.tile_uuid}</p>
        </div>
        <div className="tile-details-actions">
          <button type="button" className="tile-details-back" onClick={onBack}>
            Back to live map
          </button>
          <button
            type="button"
            className="tile-details-remove"
            onClick={() => {
              void handleDeleteTracker();
            }}
            disabled={deletePending}
          >
            {deletePending ? "Removing..." : "Remove tracker"}
          </button>
        </div>
      </div>

      {deleteError ? <p className="tile-details-error">{deleteError}</p> : null}

      {loading ? (
        <p className="tile-history-meta">
          Showing current position now. Full historical details are still loading in the background.
        </p>
      ) : null}

      <div className="tile-details-stats">
        <article>
          <h3>All-time points</h3>
          <p>{details.total_points}</p>
        </article>
        <article>
          <h3>First seen</h3>
          <p>{formatDateTime(details.first_observed_at)}</p>
        </article>
        <article>
          <h3>Last seen</h3>
          <p>{formatDateTime(details.last_observed_at)}</p>
        </article>
      </div>

      <div className="tile-details-filters">
        <label className="tile-details-filter" htmlFor="details-day-filter">
          <span>Day Filter</span>
          <select id="details-day-filter" value={selectedDay} onChange={(event) => handleDayChange(event.target.value)}>
            <option value="all">All days</option>
            {availableDays.map((day) => (
              <option key={day.date} value={day.date}>
                {day.date} ({day.point_count.toLocaleString()} pts)
              </option>
            ))}
          </select>
        </label>
        <label className="tile-details-filter" htmlFor="details-start-filter">
          <span>Start</span>
          <input
            id="details-start-filter"
            type="datetime-local"
            value={rangeStart}
            onChange={(event) => handleRangeStartChange(event.target.value)}
          />
        </label>
        <label className="tile-details-filter" htmlFor="details-end-filter">
          <span>End</span>
          <input
            id="details-end-filter"
            type="datetime-local"
            value={rangeEnd}
            onChange={(event) => handleRangeEndChange(event.target.value)}
          />
        </label>
      </div>

      <p className="tile-history-meta">
        Showing {selectedPointCount.toLocaleString()} point{selectedPointCount === 1 ? "" : "s"}
        {selectedDay === "all" ? " across all loaded days." : ` on ${selectedDay}.`}
        {isDefaultWindow ? " Using default Jul 22 06:00 to Jul 31 17:00 window." : ""}
      </p>

      {details.history_truncated ? (
        <p className="tile-history-meta">
          Loaded {details.returned_points.toLocaleString()} of {details.total_points.toLocaleString()} points
          {loading
            ? " so far. Loading additional historical points in the background."
            : " for this view."
          }
        </p>
      ) : null}

      <h3 className="tile-details-subtitle">
        {selectedDay === "all" ? "All-time track and dwell intensity" : `Track and dwell intensity for ${selectedDay}`}
      </h3>
      <TileDetailsMap
        history={filteredDetails.items}
        dwellClusters={filteredDetails.dwell_clusters}
        customAreas={mapOverlayAreas}
        selectedHotspot={selectedHotspot}
        showGisLayers={showGisLayers}
      />

      <div className="tile-details-grids">
        <section>
          <h3 className="tile-details-subtitle">Top dwell hotspots</h3>
          <DwellHotspotsPanel
            details={hotspotDetails}
            selectedHotspot={selectedHotspot}
            onSelectHotspot={setSelectedHotspot}
            onCreateArea={handleCreateArea}
          />
        </section>
      </div>

      <section>
        <h3 className="tile-details-subtitle">Custom areas</h3>
        <CustomAreasPanel
          areas={details.custom_areas}
          onRename={renameArea}
          onDelete={deleteArea}
          onDeleteMany={deleteAreas}
          onMergeAreas={mergeAreas}
          onUndoMerge={undoMerge}
          latestMergeUndo={latestMergeUndo}
        />
      </section>
    </section>
  );
}
