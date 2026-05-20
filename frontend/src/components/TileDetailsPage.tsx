import { useMemo, useState } from "react";
import { TileDetailsMap } from "./TileDetailsMap";
import type { TileDetails } from "../hooks/useTileDetails";
import {
  analyzeDwellHotspots,
  type DwellTimeFilter,
  type DwellViewMode,
} from "../utils/dwellAnalytics";

type TileDetailsPageProps = {
  details: TileDetails | null;
  loading: boolean;
  onBack: () => void;
};

type DailyBreakdownProps = {
  details: TileDetails;
};

type DwellHotspotsProps = {
  details: TileDetails;
};

type DetailsContentProps = {
  details: TileDetails;
  onBack: () => void;
};

type OverallSort = "minutes" | "visits" | "samples";
type TimelineSort = "recent" | "duration";

type DwellControlsProps = {
  viewMode: DwellViewMode;
  timeFilter: DwellTimeFilter;
  overallSort: OverallSort;
  timelineSort: TimelineSort;
  onViewModeChange: (value: DwellViewMode) => void;
  onTimeFilterChange: (value: DwellTimeFilter) => void;
  onOverallSortChange: (value: OverallSort) => void;
  onTimelineSortChange: (value: TimelineSort) => void;
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

export function TileDetailsPage({ details, loading, onBack }: TileDetailsPageProps) {
  if (loading) {
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

  return <DetailsContent details={details} onBack={onBack} />;
}

function DailyBreakdown({ details }: DailyBreakdownProps) {
  if (details.daily_breakdown.length === 0) {
    return <p className="tile-list-empty">No daily activity yet.</p>;
  }

  return (
    <ul className="tile-details-list">
      {details.daily_breakdown.map((day) => (
        <li key={day.date} className="tile-details-item">
          <strong>{day.date}</strong>
          <span>{day.point_count} points</span>
          <span>{formatMinutes(day.total_span_minutes)} span</span>
        </li>
      ))}
    </ul>
  );
}

function DwellHotspots({ details }: DwellHotspotsProps) {
  const [viewMode, setViewMode] = useState<DwellViewMode>("overall");
  const [timeFilter, setTimeFilter] = useState<DwellTimeFilter>("ever");
  const [overallSort, setOverallSort] = useState<OverallSort>("minutes");
  const [timelineSort, setTimelineSort] = useState<TimelineSort>("recent");

  const dwell = useMemo(
    () => analyzeDwellHotspots(details.items, timeFilter, details.last_observed_at),
    [details.items, details.last_observed_at, timeFilter],
  );

  const sortedOverall = useMemo(() => {
    const items = [...dwell.overall];
    if (overallSort === "visits") {
      items.sort((a, b) => b.visitCount - a.visitCount || b.minutesSpent - a.minutesSpent);
    } else if (overallSort === "samples") {
      items.sort((a, b) => b.samples - a.samples || b.minutesSpent - a.minutesSpent);
    } else {
      items.sort((a, b) => b.minutesSpent - a.minutesSpent || b.visitCount - a.visitCount);
    }
    return items.slice(0, 12);
  }, [dwell.overall, overallSort]);

  const sortedTimeline = useMemo(() => {
    const items = [...dwell.visits];
    if (timelineSort === "duration") {
      items.sort((a, b) => b.minutesSpent - a.minutesSpent || b.samples - a.samples);
    } else {
      items.sort(
        (a, b) =>
          new Date(b.startObservedAt).getTime() - new Date(a.startObservedAt).getTime() ||
          b.minutesSpent - a.minutesSpent,
      );
    }
    return items.slice(0, 18);
  }, [dwell.visits, timelineSort]);

  if (dwell.overall.length === 0) {
    return <p className="tile-list-empty">No dwell hotspots yet.</p>;
  }

  return (
    <>
      <DwellControls
        viewMode={viewMode}
        timeFilter={timeFilter}
        overallSort={overallSort}
        timelineSort={timelineSort}
        onViewModeChange={setViewMode}
        onTimeFilterChange={setTimeFilter}
        onOverallSortChange={setOverallSort}
        onTimelineSortChange={setTimelineSort}
      />
      {viewMode === "overall" ? (
        <OverallHotspotList sortedOverall={sortedOverall} />
      ) : (
        <TimelineVisitList sortedTimeline={sortedTimeline} />
      )}
    </>
  );
}

function DwellControls({
  viewMode,
  timeFilter,
  overallSort,
  timelineSort,
  onViewModeChange,
  onTimeFilterChange,
  onOverallSortChange,
  onTimelineSortChange,
}: DwellControlsProps) {
  return (
    <div className="tile-details-filters">
      <label className="tile-details-filter" htmlFor="dwell-view-mode">
        <span>View</span>
        <select id="dwell-view-mode" value={viewMode} onChange={(event) => onViewModeChange(event.target.value as DwellViewMode)}>
          <option value="overall">Overall</option>
          <option value="timeline">Timeline</option>
        </select>
      </label>

      <label className="tile-details-filter" htmlFor="dwell-time-filter">
        <span>Window</span>
        <select id="dwell-time-filter" value={timeFilter} onChange={(event) => onTimeFilterChange(event.target.value as DwellTimeFilter)}>
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
          <select id="dwell-overall-sort" value={overallSort} onChange={(event) => onOverallSortChange(event.target.value as OverallSort)}>
            <option value="minutes">Most time</option>
            <option value="visits">Most visits</option>
            <option value="samples">Most samples</option>
          </select>
        </label>
      ) : (
        <label className="tile-details-filter" htmlFor="dwell-timeline-sort">
          <span>Sort</span>
          <select id="dwell-timeline-sort" value={timelineSort} onChange={(event) => onTimelineSortChange(event.target.value as TimelineSort)}>
            <option value="recent">Most recent</option>
            <option value="duration">Longest stay</option>
          </select>
        </label>
      )}
    </div>
  );
}

function OverallHotspotList({ sortedOverall }: { sortedOverall: ReturnType<typeof analyzeDwellHotspots>["overall"] }) {
  return (
    <ol className="tile-details-list tile-details-list-ranked">
      {sortedOverall.map((cluster) => (
        <li key={`${cluster.hotspotId}-${cluster.latitude}-${cluster.longitude}`} className="tile-details-item">
          <strong>{formatMinutes(cluster.minutesSpent)}</strong>
          <span>{cluster.visitCount} visits</span>
          <span>{cluster.samples} samples</span>
          <span>
            {cluster.latitude.toFixed(5)}, {cluster.longitude.toFixed(5)}
          </span>
        </li>
      ))}
    </ol>
  );
}

function TimelineVisitList({ sortedTimeline }: { sortedTimeline: ReturnType<typeof analyzeDwellHotspots>["visits"] }) {
  return (
    <ol className="tile-details-list tile-details-list-ranked">
      {sortedTimeline.map((visit, index) => (
        <li key={`${visit.hotspotId}-${visit.startObservedAt}-${index}`} className="tile-details-item">
          <strong>{formatMinutes(visit.minutesSpent)}</strong>
          <span>
            {formatDateTime(visit.startObservedAt)} to {formatDateTime(visit.endObservedAt)}
          </span>
          <span>Hotspot #{visit.hotspotId + 1}</span>
          <span>
            {visit.latitude.toFixed(5)}, {visit.longitude.toFixed(5)}
          </span>
        </li>
      ))}
    </ol>
  );
}

function DetailsContent({ details, onBack }: DetailsContentProps) {
  return (
    <section className="tile-details-panel">
      <div className="tile-details-header">
        <div>
          <p className="tile-history-kicker">Tile details</p>
          <h2>{details.label}</h2>
          <p className="tile-history-meta">{details.tile_uuid}</p>
        </div>
        <button type="button" className="tile-details-back" onClick={onBack}>
          Back to live map
        </button>
      </div>

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

      <h3 className="tile-details-subtitle">All-time track and dwell intensity</h3>
      <TileDetailsMap history={details.items} dwellClusters={details.dwell_clusters} />

      <div className="tile-details-grids">
        <section>
          <h3 className="tile-details-subtitle">Daily breakdown</h3>
          <DailyBreakdown details={details} />
        </section>

        <section>
          <h3 className="tile-details-subtitle">Top dwell hotspots</h3>
          <DwellHotspots details={details} />
        </section>
      </div>
    </section>
  );
}
