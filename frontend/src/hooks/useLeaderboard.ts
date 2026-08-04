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

export interface LeaderboardEntry {
  rank: number;
  tile_uuid: string;
  label: string;
  value: number;
}

export interface LeaderboardData {
  date: string | null;
  distance: LeaderboardEntry[];
  camp_time: LeaderboardEntry[];
  patch_trading_time: LeaderboardEntry[];
}

export function useLeaderboard(backendUrl: string, date: string | null) {
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLeaderboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = date
        ? `${backendUrl}/leaderboard?date=${date}`
        : `${backendUrl}/leaderboard`;
      const res = await fetchWithTimeout(url, 12000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as LeaderboardData;
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
  }, [backendUrl, date]);

  useEffect(() => {
    void fetchLeaderboard();
    const interval = setInterval(() => void fetchLeaderboard(), 60_000);
    return () => clearInterval(interval);
  }, [fetchLeaderboard]);

  return { data, loading, error, refresh: fetchLeaderboard };
}
