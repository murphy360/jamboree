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
  import.meta.env.VITE_TILE_DETAILS_HISTORY_LIMIT ?? "3000",
);

function buildDetailsUrl(baseUrl: string, tileUuid: string): string {
  const url = new URL(`${baseUrl}/tiles/${encodeURIComponent(tileUuid)}/details`, window.location.origin);
  if (Number.isFinite(DEFAULT_TILE_DETAILS_HISTORY_LIMIT) && DEFAULT_TILE_DETAILS_HISTORY_LIMIT > 0) {
    url.searchParams.set("history_limit", String(DEFAULT_TILE_DETAILS_HISTORY_LIMIT));
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
        const response = await fetch(
          buildDetailsUrl(normalizedBaseUrl, tileUuid),
        );

        if (!response.ok) {
          throw new Error(`Details request failed with ${response.status}`);
        }

        const payload = (await response.json()) as TileDetails;
        if (!cancelled) {
          setDetails(payload);
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
  }, [normalizedBaseUrl, tileUuid, refreshKey, initialLocation]);

  return { details, loading };
}
