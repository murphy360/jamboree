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

type TileSocketCallbacks = {
  onConnected: (connected: boolean) => void;
  onItems: (items: TileLocation[]) => void;
};

type TileSocketSession = {
  dispose: () => void;
};

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
    const ws = new WebSocket(url);
    socket = ws;
    ws.addEventListener("open", () => handleOpen(ws, callbacks, () => isDisposed));
    ws.addEventListener("close", () => handleClose(connect, callbacks, () => isDisposed, reconnectTimer, (value) => {
      reconnectTimer = value;
    }));
    ws.addEventListener("message", (event) => handleMessage(event.data, callbacks));
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
  if (isDisposed()) {
    return;
  }

  callbacks.onConnected(false);
  if (reconnectTimer) {
    return;
  }

  const timer = setTimeout(() => {
    setReconnectTimer(null);
    if (!isDisposed()) {
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

export function useTileLocations(url: string) {
  const [locations, setLocations] = useState<TileLocation[]>([]);
  const [connected, setConnected] = useState(false);

  const normalizedUrl = useMemo(() => url.trim(), [url]);

  useEffect(() => {
    if (!normalizedUrl) {
      return;
    }

    const session = createTileSocketSession(normalizedUrl, {
      onConnected: setConnected,
      onItems: setLocations,
    });

    return () => {
      session.dispose();
    };
  }, [normalizedUrl]);

  return { locations, connected };
}
