import { useDwellAreaSelect } from "../hooks/useDwellAreaSelect";
import { useDwellSorting, type DwellOverallDisplayRow, type DwellTimelineDisplayRow } from "../hooks/useDwellSorting";
import type { DwellViewMode, DwellTimeFilter } from "../utils/dwellAnalytics";
import type { TileDetails, AreaPolygonPoint } from "../hooks/useTileDetails";

type OverallSort = "minutes" | "visits" | "samples";
type TimelineSort = "recent" | "oldest";

export type SelectedHotspot = {
  latitude: number;
  longitude: number;
  label: string;
};

type DwellHotspotsPanelProps = {
  details: TileDetails;
  selectedHotspot: SelectedHotspot | null;
  onSelectHotspot: (hotspot: SelectedHotspot) => void;
  onCreateArea: (
    name: string,
    centers: AreaPolygonPoint[],
    options?: { mergeIntoAreaId?: string; mergeSourceAreaIds?: string[]; hotspotCenters?: AreaPolygonPoint[] },
  ) => Promise<void>;
};

type DwellControlsProps = {
  viewMode: DwellViewMode;
  timeFilter: DwellTimeFilter;
  overallSort: OverallSort;
  timelineSort: TimelineSort;
  selectMode: boolean;
  selectedCount: number;
  canCreate: boolean;
  creating: boolean;
  actionLabel: string;
  onViewModeChange: (value: DwellViewMode) => void;
  onTimeFilterChange: (value: DwellTimeFilter) => void;
  onOverallSortChange: (value: OverallSort) => void;
  onTimelineSortChange: (value: TimelineSort) => void;
  onToggleSelectMode: () => void;
  onCreateArea: () => void;
};

type OverallHotspotListProps = {
  sortedOverall: DwellOverallDisplayRow[];
  selectedHotspot: SelectedHotspot | null;
  selectMode: boolean;
  selectedIds: Set<string>;
  onSelectHotspot: (hotspot: SelectedHotspot) => void;
  onToggleId: (id: string) => void;
};

type TimelineVisitListProps = {
  sortedTimeline: DwellTimelineDisplayRow[];
  selectedHotspot: SelectedHotspot | null;
  selectMode: boolean;
  selectedIds: Set<string>;
  onSelectHotspot: (hotspot: SelectedHotspot) => void;
  onToggleId: (id: string) => void;
};

type AreaCreateFormProps = {
  value: string;
  creating: boolean;
  onChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return parsed.toLocaleString();
}

function formatMinutes(value: number): string {
  if (value < 60) return `${value} min`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`;
}

function hotspotKey(lat: number, lon: number): string {
  return `${lat.toFixed(6)}:${lon.toFixed(6)}`;
}

function hotspotLabelWithCoords(label: string, latitude: number, longitude: number): string {
  return `${label} (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`;
}

function isSelectedHotspot(sel: SelectedHotspot | null, lat: number, lon: number): boolean {
  if (!sel) return false;
  return hotspotKey(sel.latitude, sel.longitude) === hotspotKey(lat, lon);
}

function AreaCreateForm({ value, creating, onChange, onConfirm, onCancel }: AreaCreateFormProps) {
  return (
    <div className="tile-area-create-row">
      <input
        className="tile-area-name-input"
        placeholder="Area name..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") onConfirm(); }}
        autoFocus
      />
      <button type="button" className="tile-area-confirm" onClick={onConfirm} disabled={creating || !value.trim()}>
        {creating ? "Creating..." : "Create"}
      </button>
      <button type="button" className="tile-area-cancel" onClick={onCancel}>Cancel</button>
    </div>
  );
}

export function DwellHotspotsPanel({ details, selectedHotspot, onSelectHotspot, onCreateArea }: DwellHotspotsPanelProps) {
  const areaPolygons = details.custom_areas.map((a) => a.polygon);
  const sorting = useDwellSorting(details, areaPolygons);
  const areaSelect = useDwellAreaSelect({ selectableLocations: sorting.selectableLocations, onCreateArea });

  if (sorting.dwell.overall.length === 0 && details.custom_areas.length === 0) {
    return <p className="tile-list-empty">No dwell hotspots yet.</p>;
  }

  return (
    <>
      <DwellControls
        viewMode={sorting.viewMode} timeFilter={sorting.timeFilter}
        overallSort={sorting.overallSort} timelineSort={sorting.timelineSort}
        selectMode={areaSelect.selectMode} selectedCount={areaSelect.selectedIds.size}
        canCreate={areaSelect.canCreate}
        creating={areaSelect.creating}
        actionLabel={areaSelect.mergeMode ? `Merge into ${areaSelect.mergeIntoAreaLabel ?? "area"}` : "Create area"}
        onViewModeChange={sorting.setViewMode} onTimeFilterChange={sorting.setTimeFilter}
        onOverallSortChange={sorting.setOverallSort} onTimelineSortChange={sorting.setTimelineSort}
        onToggleSelectMode={areaSelect.toggleSelectMode} onCreateArea={areaSelect.startCreateOrMerge}
      />
      {areaSelect.naming && (
        <AreaCreateForm
          value={areaSelect.areaNameInput} creating={areaSelect.creating}
          onChange={areaSelect.setAreaNameInput} onConfirm={() => void areaSelect.confirmCreate()}
          onCancel={() => { areaSelect.setNaming(false); areaSelect.setAreaNameInput(""); }}
        />
      )}
      {sorting.viewMode === "overall" ? (
        <OverallHotspotList
          sortedOverall={sorting.sortedOverall} selectedHotspot={selectedHotspot}
          selectMode={areaSelect.selectMode} selectedIds={areaSelect.selectedIds}
          onSelectHotspot={onSelectHotspot} onToggleId={areaSelect.toggleId}
        />
      ) : (
        <TimelineVisitList
          sortedTimeline={sorting.sortedTimeline} selectedHotspot={selectedHotspot}
          selectMode={areaSelect.selectMode} selectedIds={areaSelect.selectedIds}
          onSelectHotspot={onSelectHotspot} onToggleId={areaSelect.toggleId}
        />
      )}
    </>
  );
}

function DwellControls({ viewMode, timeFilter, overallSort, timelineSort, selectMode, selectedCount, canCreate, creating, actionLabel, onViewModeChange, onTimeFilterChange, onOverallSortChange, onTimelineSortChange, onToggleSelectMode, onCreateArea }: DwellControlsProps) {
  return (
    <div className="tile-details-filters">
      <label className="tile-details-filter" htmlFor="dwell-view-mode">
        <span>View</span>
        <select id="dwell-view-mode" value={viewMode} onChange={(e) => onViewModeChange(e.target.value as DwellViewMode)}>
          <option value="overall">Overall</option>
          <option value="timeline">Timeline</option>
        </select>
      </label>
      <label className="tile-details-filter" htmlFor="dwell-time-filter">
        <span>Window</span>
        <select id="dwell-time-filter" value={timeFilter} onChange={(e) => onTimeFilterChange(e.target.value as DwellTimeFilter)}>
          <option value="day">Day</option>
          <option value="week">Week</option>
          <option value="month">Month</option>
          <option value="year">Year</option>
          <option value="ever">Ever</option>
        </select>
      </label>
      {viewMode === "overall" ? (
        <label className="tile-details-filter" htmlFor="dwell-overall-sort">
          <span>Sort</span>
          <select id="dwell-overall-sort" value={overallSort} onChange={(e) => onOverallSortChange(e.target.value as OverallSort)}>
            <option value="minutes">Most time</option>
            <option value="visits">Most visits</option>
            <option value="samples">Most samples</option>
          </select>
        </label>
      ) : (
        <label className="tile-details-filter" htmlFor="dwell-timeline-sort">
          <span>Sort</span>
          <select id="dwell-timeline-sort" value={timelineSort} onChange={(e) => onTimelineSortChange(e.target.value as TimelineSort)}>
            <option value="recent">Most recent</option>
            <option value="oldest">Route order (oldest first)</option>
          </select>
        </label>
      )}
      <div className="tile-area-actions">
        <button type="button" className={selectMode ? "tile-area-btn is-active" : "tile-area-btn"} onClick={onToggleSelectMode}>
          {selectMode ? "Cancel" : "Select"}
        </button>
        {selectMode && (
          <button type="button" className="tile-area-btn tile-area-btn-create" onClick={onCreateArea} disabled={!canCreate || creating}>
            {creating ? "Working..." : `${actionLabel} (${selectedCount})`}
          </button>
        )}
      </div>
    </div>
  );
}

function OverallHotspotList({ sortedOverall, selectedHotspot, selectMode, selectedIds, onSelectHotspot, onToggleId }: OverallHotspotListProps) {
  return (
    <ol className="tile-details-list tile-details-list-ranked">
      {sortedOverall.map((cluster) => (
        <li key={cluster.entryId} className="tile-details-item">
          {selectMode && (
            <input
              type="checkbox" className="tile-area-checkbox"
              checked={selectedIds.has(cluster.entryId)}
              onChange={() => onToggleId(cluster.entryId)}
              aria-label={`Select ${cluster.locationLabel}`}
            />
          )}
          <button
            type="button"
            className={isSelectedHotspot(selectedHotspot, cluster.latitude, cluster.longitude) ? "tile-details-item-button is-active" : "tile-details-item-button"}
            onClick={() =>
              onSelectHotspot({
                latitude: cluster.latitude,
                longitude: cluster.longitude,
                label: hotspotLabelWithCoords(cluster.locationLabel, cluster.latitude, cluster.longitude),
              })
            }
          >
            <strong>{formatMinutes(cluster.minutesSpent)}</strong>
            <span>{cluster.visitCount} visits</span>
            <span>{cluster.samples} samples</span>
            <span>{cluster.locationLabel}</span>
            <span>{cluster.latitude.toFixed(5)}, {cluster.longitude.toFixed(5)}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

function TimelineVisitList({ sortedTimeline, selectedHotspot, selectMode, selectedIds, onSelectHotspot, onToggleId }: TimelineVisitListProps) {
  return (
    <ol className="tile-details-list tile-details-list-ranked">
      {sortedTimeline.map((visit, index) => (
        <li key={`${visit.entryId}-${visit.startObservedAt}-${index}`} className="tile-details-item">
          {selectMode && (
            <input
              type="checkbox" className="tile-area-checkbox"
              checked={selectedIds.has(visit.entryId)}
              onChange={() => onToggleId(visit.entryId)}
              aria-label={`Select ${visit.locationLabel}`}
            />
          )}
          <button
            type="button"
            className={isSelectedHotspot(selectedHotspot, visit.latitude, visit.longitude) ? "tile-details-item-button is-active" : "tile-details-item-button"}
            onClick={() =>
              onSelectHotspot({
                latitude: visit.latitude,
                longitude: visit.longitude,
                label: hotspotLabelWithCoords(visit.locationLabel, visit.latitude, visit.longitude),
              })
            }
          >
            <strong>{formatMinutes(visit.minutesSpent)}</strong>
            <span>{formatDateTime(visit.startObservedAt)} to {formatDateTime(visit.endObservedAt)}</span>
            <span>{visit.locationLabel}</span>
            <span>{visit.latitude.toFixed(5)}, {visit.longitude.toFixed(5)}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
