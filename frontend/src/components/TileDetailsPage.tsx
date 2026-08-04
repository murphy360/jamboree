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
  onTrackerRemoved: () => void;
  baseUrl: string;
  tileUuid: string;
  onRefreshDetails: () => void;
  showGisLayers: boolean;
};

type DailyBreakdownProps = {
  details: TileDetails;
};

type DetailsContentProps = {
  details: TileDetails;
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

export function TileDetailsPage({ details, loading, onBack, onTrackerRemoved, baseUrl, tileUuid, onRefreshDetails, showGisLayers }: TileDetailsPageProps) {
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

  return (
    <DetailsContent
      details={details}
      onBack={onBack}
      onTrackerRemoved={onTrackerRemoved}
      baseUrl={baseUrl}
      tileUuid={tileUuid}
      onRefreshDetails={onRefreshDetails}
      showGisLayers={showGisLayers}
    />
  );
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


function DetailsContent({ details, onBack, onTrackerRemoved, baseUrl, tileUuid, onRefreshDetails, showGisLayers }: DetailsContentProps) {
  const [selectedHotspot, setSelectedHotspot] = useState<SelectedHotspot | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { createArea, renameArea, deleteArea } = useCustomAreas({
    baseUrl,
    tileUuid,
    onRefresh: onRefreshDetails,
  });

  const handleCreateArea = useCallback(
    (name: string, centers: { latitude: number; longitude: number }[], options?: CreateAreaOptions) => createArea(name, centers, options),
    [createArea],
  );

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

      {details.history_truncated ? (
        <p className="tile-history-meta">
          Loaded {details.returned_points.toLocaleString()} of {details.total_points.toLocaleString()} points
          to keep the page responsive. Increase VITE_TILE_DETAILS_HISTORY_LIMIT to load more.
        </p>
      ) : null}

      <h3 className="tile-details-subtitle">All-time track and dwell intensity</h3>
      <TileDetailsMap
        history={details.items}
        dwellClusters={details.dwell_clusters}
        customAreas={details.custom_areas}
        selectedHotspot={selectedHotspot}
        showGisLayers={showGisLayers}
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
