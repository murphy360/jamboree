import { useEffect, useMemo, useState } from "react";

export type TileLocation = {
  tile_uuid: string;
  label: string;
  latitude: number;
  longitude: number;
  observed_at: string;
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

    const socket = new WebSocket(normalizedUrl);

    socket.addEventListener("open", () => {
      setConnected(true);
      socket.send("hello");
    });

    socket.addEventListener("close", () => {
      setConnected(false);
    });

    socket.addEventListener("message", (event) => {
      try {
        const parsed = JSON.parse(event.data) as LocationMessage;
        if (parsed.type === "tile_locations" && Array.isArray(parsed.items)) {
          setLocations(parsed.items);
        }
      } catch {
        // Ignore malformed messages; backend API is unofficial.
      }
    });

    return () => {
      socket.close();
    };
  }, [normalizedUrl]);

  return { locations, connected };
}
