import { useEffect, useMemo, useState } from "react";
import type { TileLocation } from "./useTileLocations";

type TileHistoryResponse = {
  tile_uuid: string;
  label: string;
  items: TileLocation[];
};

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
          `${normalizedBaseUrl}/tiles/${encodeURIComponent(tileUuid)}/history`,
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
