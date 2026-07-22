import asyncio
import logging
from datetime import datetime
from typing import Protocol

from src.services.history_store import TileHistoryStore
from src.services.models import TileLocation
from src.services.ws_manager import WebSocketManager

LOGGER = logging.getLogger(__name__)


class TrackerClient(Protocol):
    async def list_tiles(self) -> list: ...

    async def get_tile_location(self, tile_uuid: str, label: str): ...


class TilePoller:
    def __init__(
        self,
        tile_client: TrackerClient,
        ws_manager: WebSocketManager,
        history_store: TileHistoryStore,
        interval_seconds: int,
    ) -> None:
        self.tile_client = tile_client
        self.ws_manager = ws_manager
        self.history_store = history_store
        self.interval_seconds = interval_seconds
        self._shutdown = asyncio.Event()
        self._poll_lock = asyncio.Lock()
        self._latest_cache: list[TileLocation] = []

    def get_cached_latest_locations(self) -> list[TileLocation]:
        return list(self._latest_cache)

    def clear_cached_latest_locations(self) -> None:
        self._latest_cache = []

    async def stop(self) -> None:
        self._shutdown.set()

    async def run(self) -> None:
        print(f"=== POLLER RUN: Starting with {self.interval_seconds}s interval")
        poll_count = 0
        try:
            while not self._shutdown.is_set():
                print(f"=== POLLER: About to call poll_now (cycle {poll_count + 1})")
                await self.poll_now()
                poll_count += 1
                now = datetime.now().strftime("%H:%M:%S")
                print(f"[{now}] === POLLER: Completed cycle {poll_count}")
                print(f"[{now}] === POLLER: Entering wait with {self.interval_seconds}s timeout")
                try:
                    result = await asyncio.wait_for(self._shutdown.wait(), timeout=self.interval_seconds)
                    print(f"[{now}] === POLLER: Shutdown event triggered!")
                except asyncio.TimeoutError:
                    now = datetime.now().strftime("%H:%M:%S")
                    print(f"[{now}] === POLLER: Timeout fired, continuing to next cycle")
                    continue
        except Exception as e:
            now = datetime.now().strftime("%H:%M:%S")
            print(f"[{now}] === POLLER RUN CRASHED: {e}")
            LOGGER.exception("Poller run loop crashed: %s", e)

    async def poll_now(self) -> None:
        async with self._poll_lock:
            await self._poll_once()

    async def _poll_once(self) -> None:
        try:
            now = datetime.now().strftime("%H:%M:%S")
            print(f"[{now}] === POLLER: Starting poll cycle")
            tiles = await self.tile_client.list_tiles()
            print(f"[{now}] === POLLER: found {len(tiles)} tiles")
            updates: list[TileLocation] = []
            for tile in tiles:
                location = await self.tile_client.get_tile_location(tile.uuid, tile.name)
                if location:
                    updates.append(location)

            if updates:
                print(f"[{now}] === POLLER: Recording {len(updates)} location updates")
                await asyncio.to_thread(self.history_store.record, updates)
                self._latest_cache = sorted(updates, key=lambda item: item.label)

            if self.ws_manager.has_connections():
                # Prefer fresh poll results for live updates; fall back to storage when needed.
                if updates:
                    latest = self.get_cached_latest_locations()
                else:
                    latest = await asyncio.to_thread(self.history_store.get_latest_locations)
                print(f"[{now}] === POLLER: Broadcasting {len(latest)} latest locations")
                await self.ws_manager.broadcast(
                    {
                        "type": "tile_locations",
                        "items": [item.model_dump(mode="json") for item in latest],
                    }
                )
            else:
                print(f"[{now}] === POLLER: No WS connections, skipping broadcast")
            print(f"[{now}] === POLLER: Poll cycle complete")
        except Exception as exc:
            now = datetime.now().strftime("%H:%M:%S")
            print(f"[{now}] === POLLER ERROR: {exc}")
            LOGGER.exception("Tile polling error: %s", exc)
