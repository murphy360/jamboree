import { useEffect, useState } from "react";

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

type TileSocketCallbacks = {
  onConnected: (connected: boolean) => void;
  onItems: (items: TileLocation[]) => void;
};

type TileSocketSession = {
  dispose: () => void;
};

async function fetchLatestLocations(baseUrl: string): Promise<TileLocation[]> {
  try {
    const response = await fetch(`${baseUrl}/locations/latest`);
    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as TileLocation[];
    return Array.isArray(payload) ? payload : [];
  } catch {
    return [];
  }
}

function parseLocationMessage(payload: string): TileLocation[] | null {
  try {
    const parsed = JSON.parse(payload) as LocationMessage;
    if (parsed.type === "tile_locations" && Array.isArray(parsed.items)) {
      return parsed.items;
    }
  } catch {
    return null;
  }

  return null;
}

function createTileSocketSession(url: string, callbacks: TileSocketCallbacks): TileSocketSession {
  let isDisposed = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    console.log(`[useTileLocations] Attempting to connect to: ${url}`);
    const ws = new WebSocket(url);
    socket = ws;
    ws.addEventListener("open", () => {
      console.log("[useTileLocations] WebSocket OPEN event fired");
      handleOpen(ws, callbacks, () => isDisposed);
    });
    ws.addEventListener("close", () => {
      console.log("[useTileLocations] WebSocket CLOSE event fired");
      handleClose(connect, callbacks, () => isDisposed, reconnectTimer, (value) => {
        reconnectTimer = value;
      });
    });
    ws.addEventListener("error", (event) => {
      console.log("[useTileLocations] WebSocket ERROR event fired:", event);
    });
    ws.addEventListener("message", (event) => {
      console.log("[useTileLocations] WebSocket MESSAGE received:", event.data);
      handleMessage(event.data, callbacks);
    });
  };

  connect();

  return {
    dispose: () => {
      isDisposed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      safelyCloseSocket(socket);
    },
  };
}

function handleOpen(ws: WebSocket, callbacks: TileSocketCallbacks, isDisposed: () => boolean) {
  if (isDisposed()) {
    ws.close();
    return;
  }

  callbacks.onConnected(true);
  ws.send("hello");
}

function handleClose(
  reconnect: () => void,
  callbacks: TileSocketCallbacks,
  isDisposed: () => boolean,
  reconnectTimer: ReturnType<typeof setTimeout> | null,
  setReconnectTimer: (value: ReturnType<typeof setTimeout> | null) => void,
) {
  console.log("[useTileLocations] handleClose() called");
  if (isDisposed()) {
    console.log("[useTileLocations] Socket was disposed, not reconnecting");
    return;
  }

  console.log("[useTileLocations] Notifying client of disconnection");
  callbacks.onConnected(false);
  if (reconnectTimer) {
    console.log("[useTileLocations] Reconnect timer already exists, not starting new one");
    return;
  }

  console.log("[useTileLocations] Starting reconnect timer (1500ms delay)");
  const timer = setTimeout(() => {
    console.log("[useTileLocations] Reconnect timer fired");
    setReconnectTimer(null);
    if (!isDisposed()) {
      console.log("[useTileLocations] Calling reconnect()");
      reconnect();
    }
  }, 1500);
  setReconnectTimer(timer);
}

function handleMessage(payload: string, callbacks: TileSocketCallbacks) {
  const items = parseLocationMessage(payload);
  if (items) {
    callbacks.onItems(items);
  }
}

function safelyCloseSocket(socket: WebSocket | null) {
  if (!socket) {
    return;
  }

  const activeSocket = socket;
  if (activeSocket.readyState === WebSocket.CONNECTING) {
    activeSocket.addEventListener(
      "open",
      () => {
        activeSocket.close();
      },
      { once: true },
    );
    return;
  }

  if (activeSocket.readyState === WebSocket.OPEN) {
    activeSocket.close();
  }
}

export function useTileLocations(baseUrl: string, url: string) {
  const [locations, setLocations] = useState<TileLocation[]>([]);
  const [connected, setConnected] = useState(false);

  const normalizedBaseUrl = baseUrl.trim().replace(/\/$/, "");
  const normalizedUrl = url.trim();

  useEffect(() => {
    if (!normalizedUrl) {
      return;
    }

    let cancelled = false;

    const refreshLatest = async () => {
      const latestLocations = await fetchLatestLocations(normalizedBaseUrl);
      if (!cancelled && latestLocations.length > 0) {
        setLocations(latestLocations);
      }
    };

    void (async () => {
      await refreshLatest();
    })();

    const session = createTileSocketSession(normalizedUrl, {
      onConnected: setConnected,
      onItems: setLocations,
    });

    // Keep a lightweight fallback refresh so the list can recover if websocket
    // updates are delayed or a connection flaps during page load.
    const refreshTimer = window.setInterval(() => {
      void refreshLatest();
    }, 5000);

    return () => {
      cancelled = true;
      session.dispose();
      window.clearInterval(refreshTimer);
    };
  }, [normalizedBaseUrl, normalizedUrl]);

  return { locations, connected };
}
