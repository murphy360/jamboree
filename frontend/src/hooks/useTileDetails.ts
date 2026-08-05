import { useEffect, useMemo, useState } from "react";
import type { TileLocation } from "./useTileLocations";

export type TileDailySummary = {
  date: string;
  point_count: number;
  start_observed_at: string;
  end_observed_at: string;
  total_span_minutes: number;
};

export type TileDwellCluster = {
  latitude: number;
  longitude: number;
  samples: number;
  minutes_spent: number;
};

export type AreaPolygonPoint = {
  latitude: number;
  longitude: number;
};

export type CustomArea = {
  area_id: string;
  tile_uuid: string;
  name: string;
  polygon: AreaPolygonPoint[];
  samples: number;
  minutes_spent: number;
  created_at: string;
  updated_at: string;
  source_type?: string;
  source_name?: string | null;
  source_url?: string | null;
  source_feature_id?: string | null;
};

export type TileDetails = {
  tile_uuid: string;
  label: string;
  total_points: number;
  returned_points: number;
  history_truncated: boolean;
  first_observed_at: string;
  last_observed_at: string;
  items: TileLocation[];
  daily_breakdown: TileDailySummary[];
  dwell_clusters: TileDwellCluster[];
  custom_areas: CustomArea[];
};

const DEFAULT_TILE_DETAILS_HISTORY_LIMIT = Number(
  import.meta.env.VITE_TILE_DETAILS_HISTORY_LIMIT ?? "7000",
);
const DEFAULT_TILE_DETAILS_INITIAL_BATCH = Number(
  import.meta.env.VITE_TILE_DETAILS_INITIAL_BATCH ?? "1000",
);
const DEFAULT_TILE_DETAILS_DEDUPE_TOLERANCE_METERS = Number(
  import.meta.env.VITE_TILE_DETAILS_DEDUPE_TOLERANCE_METERS ?? "20",
);

function buildDetailsUrl(baseUrl: string, tileUuid: string): string {
  return buildDetailsUrlWithLimit(baseUrl, tileUuid, DEFAULT_TILE_DETAILS_HISTORY_LIMIT);
}

function buildDetailsUrlWithLimit(baseUrl: string, tileUuid: string, historyLimit: number): string {
  const url = new URL(`${baseUrl}/tiles/${encodeURIComponent(tileUuid)}/details`, window.location.origin);
  if (Number.isFinite(historyLimit) && historyLimit > 0) {
    url.searchParams.set("history_limit", String(historyLimit));
  }
  url.searchParams.set("dedupe_consecutive", "true");
  if (
    Number.isFinite(DEFAULT_TILE_DETAILS_DEDUPE_TOLERANCE_METERS)
    && DEFAULT_TILE_DETAILS_DEDUPE_TOLERANCE_METERS >= 0
  ) {
    url.searchParams.set("dedupe_tolerance_meters", String(DEFAULT_TILE_DETAILS_DEDUPE_TOLERANCE_METERS));
  }
  return url.toString();
}

export function useTileDetails(
  baseUrl: string,
  tileUuid: string | null,
  refreshKey = 0,
  initialLocation: TileLocation | null = null,
) {
  const [details, setDetails] = useState<TileDetails | null>(null);
  const [loading, setLoading] = useState(false);

  const normalizedBaseUrl = useMemo(() => baseUrl.trim().replace(/\/$/, ""), [baseUrl]);

  useEffect(() => {
    if (!normalizedBaseUrl || !tileUuid) {
      setDetails(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    if (initialLocation && initialLocation.tile_uuid === tileUuid) {
      setDetails({
        tile_uuid: tileUuid,
        label: initialLocation.label,
        total_points: 1,
        returned_points: 1,
        history_truncated: false,
        first_observed_at: initialLocation.observed_at,
        last_observed_at: initialLocation.observed_at,
        items: [initialLocation],
        daily_breakdown: [],
        dwell_clusters: [],
        custom_areas: [],
      });
    }

    const loadDetails = async () => {
      setLoading(true);
      try {
        const targetLimit = Number.isFinite(DEFAULT_TILE_DETAILS_HISTORY_LIMIT) && DEFAULT_TILE_DETAILS_HISTORY_LIMIT > 0
          ? DEFAULT_TILE_DETAILS_HISTORY_LIMIT
          : 3000;
        const initialLimit = Number.isFinite(DEFAULT_TILE_DETAILS_INITIAL_BATCH) && DEFAULT_TILE_DETAILS_INITIAL_BATCH > 0
          ? Math.min(DEFAULT_TILE_DETAILS_INITIAL_BATCH, targetLimit)
          : Math.min(1000, targetLimit);
        const maxLimit = 50_000;
        const step = Math.max(500, initialLimit);
        let requestedLimit = initialLimit;

        while (!cancelled) {
          const response = await fetch(
            buildDetailsUrlWithLimit(normalizedBaseUrl, tileUuid, requestedLimit),
          );

          if (!response.ok) {
            throw new Error(`Details request failed with ${response.status}`);
          }

          const payload = (await response.json()) as TileDetails;
          if (!cancelled) {
            setDetails(payload);
          }

          if (!payload.history_truncated || payload.returned_points >= payload.total_points) {
            break;
          }

          const nextLimit = Math.min(
            maxLimit,
            targetLimit,
            Math.max(requestedLimit + step, payload.returned_points + 1),
            payload.total_points,
          );
          if (nextLimit <= requestedLimit) {
            break;
          }

          requestedLimit = nextLimit;
        }
      } catch {
        // Keep seeded/current details visible if full history loading fails.
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadDetails();

    return () => {
      cancelled = true;
    };
  }, [normalizedBaseUrl, tileUuid, refreshKey]);

  return { details, loading };
}
