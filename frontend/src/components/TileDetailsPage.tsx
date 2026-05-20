import { useCallback, useState } from "react";
import { DwellHotspotsPanel, type SelectedHotspot } from "./DwellHotspotsPanel";
import { CustomAreasPanel } from "./CustomAreasPanel";
import { TileDetailsMap } from "./TileDetailsMap";
import { useCustomAreas } from "../hooks/useCustomAreas";
import type { TileDetails } from "../hooks/useTileDetails";

type TileDetailsPageProps = {
  details: TileDetails | null;
  loading: boolean;
  onBack: () => void;
  baseUrl: string;
  tileUuid: string;
  onRefreshDetails: () => void;
};

type DailyBreakdownProps = {
  details: TileDetails;
};

type DetailsContentProps = {
  details: TileDetails;
  onBack: () => void;
  baseUrl: string;
  tileUuid: string;
  onRefreshDetails: () => void;
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

export function TileDetailsPage({ details, loading, onBack, baseUrl, tileUuid, onRefreshDetails }: TileDetailsPageProps) {
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

  return <DetailsContent details={details} onBack={onBack} baseUrl={baseUrl} tileUuid={tileUuid} onRefreshDetails={onRefreshDetails} />;
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


function DetailsContent({ details, onBack, baseUrl, tileUuid, onRefreshDetails }: DetailsContentProps) {
  const [selectedHotspot, setSelectedHotspot] = useState<SelectedHotspot | null>(null);
  const { createArea, renameArea, deleteArea } = useCustomAreas({
    baseUrl,
    tileUuid,
    onRefresh: onRefreshDetails,
  });

  const handleCreateArea = useCallback(
    (name: string, centers: { latitude: number; longitude: number }[], options?: CreateAreaOptions) => createArea(name, centers, options),
    [createArea],
  );

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
      <TileDetailsMap
        history={details.items}
        dwellClusters={details.dwell_clusters}
        customAreas={details.custom_areas}
        selectedHotspot={selectedHotspot}
      />

      <div className="tile-details-grids">
        <section>
          <h3 className="tile-details-subtitle">Daily breakdown</h3>
          <DailyBreakdown details={details} />
        </section>

        <section>
          <h3 className="tile-details-subtitle">Top dwell hotspots</h3>
          <DwellHotspotsPanel
            details={details}
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
        />
      </section>
    </section>
  );
}
