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
  first_observed_at: string;
  last_observed_at: string;
  items: TileLocation[];
  daily_breakdown: TileDailySummary[];
  dwell_clusters: TileDwellCluster[];
  custom_areas: CustomArea[];
};

export function useTileDetails(
  baseUrl: string,
  tileUuid: string | null,
  refreshKey = 0,
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

    const loadDetails = async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `${normalizedBaseUrl}/tiles/${encodeURIComponent(tileUuid)}/details`,
        );

        if (!response.ok) {
          throw new Error(`Details request failed with ${response.status}`);
        }

        const payload = (await response.json()) as TileDetails;
        if (!cancelled) {
          setDetails(payload);
        }
      } catch {
        if (!cancelled) {
          setDetails(null);
        }
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
