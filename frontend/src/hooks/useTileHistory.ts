import { useEffect, useMemo, useState } from "react";
import type { TileLocation } from "./useTileLocations";

type TileHistoryResponse = {
  tile_uuid: string;
  label: string;
  total_points?: number;
  returned_points?: number;
  history_truncated?: boolean;
  items: TileLocation[];
};

const DEFAULT_TILE_HISTORY_LIMIT = Number(import.meta.env.VITE_TILE_HISTORY_LIMIT ?? "7000");
const DEFAULT_TILE_HISTORY_INITIAL_BATCH = Number(
  import.meta.env.VITE_TILE_HISTORY_INITIAL_BATCH ?? "1000",
);
const DEFAULT_TILE_HISTORY_DEDUPE_TOLERANCE_METERS = Number(
  import.meta.env.VITE_TILE_HISTORY_DEDUPE_TOLERANCE_METERS ?? "20",
);

function buildHistoryUrl(baseUrl: string, tileUuid: string): string {
  return buildHistoryUrlWithLimit(baseUrl, tileUuid, DEFAULT_TILE_HISTORY_LIMIT);
}

function buildHistoryUrlWithLimit(baseUrl: string, tileUuid: string, limit: number): string {
  const url = new URL(`${baseUrl}/tiles/${encodeURIComponent(tileUuid)}/history`, window.location.origin);
  if (Number.isFinite(limit) && limit > 0) {
    url.searchParams.set("limit", String(limit));
  }
  url.searchParams.set("dedupe_consecutive", "true");
  if (
    Number.isFinite(DEFAULT_TILE_HISTORY_DEDUPE_TOLERANCE_METERS)
    && DEFAULT_TILE_HISTORY_DEDUPE_TOLERANCE_METERS >= 0
  ) {
    url.searchParams.set("dedupe_tolerance_meters", String(DEFAULT_TILE_HISTORY_DEDUPE_TOLERANCE_METERS));
  }
  return url.toString();
}

export function useTileHistory(baseUrl: string, tileUuid: string | null) {
  const [history, setHistory] = useState<TileLocation[]>([]);
  const [loading, setLoading] = useState(false);

  const normalizedBaseUrl = useMemo(() => baseUrl.trim().replace(/\/$/, ""), [baseUrl]);

  useEffect(() => {
    if (!normalizedBaseUrl || !tileUuid) {
      setHistory([]);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const loadHistory = async () => {
      setLoading(true);
      try {
        const targetLimit = Number.isFinite(DEFAULT_TILE_HISTORY_LIMIT) && DEFAULT_TILE_HISTORY_LIMIT > 0
          ? DEFAULT_TILE_HISTORY_LIMIT
          : 3000;
        const initialLimit = Number.isFinite(DEFAULT_TILE_HISTORY_INITIAL_BATCH) && DEFAULT_TILE_HISTORY_INITIAL_BATCH > 0
          ? Math.min(DEFAULT_TILE_HISTORY_INITIAL_BATCH, targetLimit)
          : Math.min(1000, targetLimit);
        const maxLimit = 50_000;
        const step = Math.max(500, initialLimit);
        let requestedLimit = initialLimit;

        while (!cancelled) {
          const response = await fetch(
            buildHistoryUrlWithLimit(normalizedBaseUrl, tileUuid, requestedLimit),
          );

          if (!response.ok) {
            throw new Error(`History request failed with ${response.status}`);
          }

          const payload = (await response.json()) as TileHistoryResponse;
          if (!cancelled) {
            setHistory(Array.isArray(payload.items) ? payload.items : []);
          }

          const returnedPoints = payload.returned_points ?? payload.items.length;
          const totalPoints = payload.total_points ?? returnedPoints;
          const isTruncated = Boolean(payload.history_truncated) && returnedPoints < totalPoints;

          if (!isTruncated) {
            break;
          }

          const nextLimit = Math.min(
            maxLimit,
            targetLimit,
            Math.max(requestedLimit + step, returnedPoints + 1),
            totalPoints,
          );
          if (nextLimit <= requestedLimit) {
            break;
          }

          requestedLimit = nextLimit;
        }
      } catch {
        if (!cancelled) {
          setHistory([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadHistory();

    return () => {
      cancelled = true;
    };
  }, [normalizedBaseUrl, tileUuid]);

  return { history, loading };
}
