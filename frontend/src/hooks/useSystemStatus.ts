import { useEffect, useMemo, useState } from "react";

type HealthResponse = {
  status: string;
  app_name: string;
};

type TileStatusResponse = {
  ok: boolean;
  tile_count: number;
  detail: string;
};

export function useSystemStatus(baseUrl: string) {
  const [backendConnected, setBackendConnected] = useState(false);
  const [homeAssistantConnected, setHomeAssistantConnected] = useState(false);
  const [tileCount, setTileCount] = useState(0);

  const normalizedBaseUrl = useMemo(() => baseUrl.trim().replace(/\/$/, ""), [baseUrl]);

  useEffect(() => {
    if (!normalizedBaseUrl) {
      return;
    }

    let cancelled = false;

    const refresh = async () => {
      try {
        const [healthResponse, tileStatusResponse] = await Promise.all([
          fetch(`${normalizedBaseUrl}/health`),
          fetch(`${normalizedBaseUrl}/debug/tile-status`),
        ]);

        const health = (await healthResponse.json()) as HealthResponse;
        const tileStatus = (await tileStatusResponse.json()) as TileStatusResponse;

        if (cancelled) {
          return;
        }

        setBackendConnected(healthResponse.ok && health.status === "ok");
        setHomeAssistantConnected(tileStatusResponse.ok && tileStatus.ok);
        setTileCount(tileStatus.tile_count ?? 0);
      } catch {
        if (!cancelled) {
          setBackendConnected(false);
          setHomeAssistantConnected(false);
          setTileCount(0);
        }
      }
    };

    void refresh();
    const timerId = window.setInterval(refresh, 10000);

    return () => {
      cancelled = true;
      if (timerId !== undefined) {
        window.clearInterval(timerId);
      }
    };
  }, [normalizedBaseUrl]);

  return { backendConnected, homeAssistantConnected, tileCount };
}
