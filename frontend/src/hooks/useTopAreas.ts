import { useCallback, useEffect, useState } from "react";

async function fetchWithTimeout(input: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

export interface TopAreaEntry {
  rank: number;
  area_id: string;
  area_name: string;
  minutes_spent: number;
  samples: number;
  tiles_count: number;
}

export interface TopAreasData {
  date: string | null;
  area_tile_uuid: string;
  items: TopAreaEntry[];
}

export function useTopAreas(backendUrl: string, date: string | null, limit = 20) {
  const [data, setData] = useState<TopAreasData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTopAreas = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      if (date) {
        params.set("date", date);
      }

      const res = await fetchWithTimeout(`${backendUrl}/areas/top?${params.toString()}`, 30000);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = (await res.json()) as TopAreasData;
      setData(json);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("Request timed out");
      } else {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    } finally {
      setLoading(false);
    }
  }, [backendUrl, date, limit]);

  useEffect(() => {
    void fetchTopAreas();
    const interval = window.setInterval(() => void fetchTopAreas(), 60_000);
    return () => window.clearInterval(interval);
  }, [fetchTopAreas]);

  return { data, loading, error, refresh: fetchTopAreas };
}
