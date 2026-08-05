import { useEffect, useMemo, useState } from "react";
import type { TileLocation } from "./useTileLocations";

type TileHistoryResponse = {
  tile_uuid: string;
  label: string;
  items: TileLocation[];
};

const DEFAULT_TILE_HISTORY_LIMIT = Number(import.meta.env.VITE_TILE_HISTORY_LIMIT ?? "3000");

function buildHistoryUrl(baseUrl: string, tileUuid: string): string {
  const url = new URL(`${baseUrl}/tiles/${encodeURIComponent(tileUuid)}/history`, window.location.origin);
  if (Number.isFinite(DEFAULT_TILE_HISTORY_LIMIT) && DEFAULT_TILE_HISTORY_LIMIT > 0) {
    url.searchParams.set("limit", String(DEFAULT_TILE_HISTORY_LIMIT));
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
        const response = await fetch(
          buildHistoryUrl(normalizedBaseUrl, tileUuid),
        );

        if (!response.ok) {
          throw new Error(`History request failed with ${response.status}`);
        }

        const payload = (await response.json()) as TileHistoryResponse;
        if (!cancelled) {
          setHistory(Array.isArray(payload.items) ? payload.items : []);
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
