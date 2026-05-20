import { TileDetailsMap } from "./TileDetailsMap";
import type { TileDetails } from "../hooks/useTileDetails";

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
  const topClusters = details.dwell_clusters.slice(0, 8);

  if (topClusters.length === 0) {
    return <p className="tile-list-empty">No dwell hotspots yet.</p>;
  }

  return (
    <ol className="tile-details-list tile-details-list-ranked">
      {topClusters.map((cluster) => (
        <li key={`${cluster.latitude}-${cluster.longitude}`} className="tile-details-item">
          <strong>{formatMinutes(cluster.minutes_spent)}</strong>
          <span>{cluster.samples} samples</span>
          <span>
            {cluster.latitude.toFixed(5)}, {cluster.longitude.toFixed(5)}
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
