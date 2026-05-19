import { useEffect, useMemo, useState } from "react";

export type TileLocation = {
  tile_uuid: string;
  label: string;
  latitude: number;
  longitude: number;
  observed_at: string;
  tile_service_observed_at?: string | null;
  polled_at?: string | null;
};

type LocationMessage = {
  type: "tile_locations";
  items: TileLocation[];
};

export function useTileLocations(url: string) {
  const [locations, setLocations] = useState<TileLocation[]>([]);
  const [connected, setConnected] = useState(false);

  const normalizedUrl = useMemo(() => url.trim(), [url]);

  useEffect(() => {
    if (!normalizedUrl) return;
    let isDisposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleReconnect = () => {
      if (isDisposed || reconnectTimer) {
        return;
      }

      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (!isDisposed) {
          connect();
        }
      }, 1500);
    };

    const connect = () => {
      const ws = new WebSocket(normalizedUrl);
      socket = ws;

      ws.addEventListener("open", () => {
        if (isDisposed) {
          ws.close();
          return;
        }
        setConnected(true);
        ws.send("hello");
      });

      ws.addEventListener("close", () => {
        if (isDisposed) {
          return;
        }
        setConnected(false);
        scheduleReconnect();
      });

      ws.addEventListener("message", (event) => {
        if (isDisposed) {
          return;
        }
        try {
          const parsed = JSON.parse(event.data) as LocationMessage;
          if (parsed.type === "tile_locations" && Array.isArray(parsed.items)) {
            setLocations(parsed.items);
          }
        } catch {
          // Ignore malformed messages; backend API is unofficial.
        }
      });
    };

    connect();

    return () => {
      isDisposed = true;

      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }

      if (!socket) {
        return;
      }

      if (socket.readyState === WebSocket.CONNECTING) {
        // In React StrictMode, effects mount/unmount twice in dev. Delay close
        // until the connection opens to avoid noisy "closed before established" logs.
        socket.addEventListener(
          "open",
          () => {
            socket.close();
          },
          { once: true },
        );
        return;
      }

      if (socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
    };
  }, [normalizedUrl]);

  return { locations, connected };
}
