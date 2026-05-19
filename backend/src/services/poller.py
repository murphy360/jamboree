import asyncio
import logging
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

    async def stop(self) -> None:
        self._shutdown.set()

    async def run(self) -> None:
        while not self._shutdown.is_set():
            await self.poll_now()
            try:
                await asyncio.wait_for(self._shutdown.wait(), timeout=self.interval_seconds)
            except TimeoutError:
                continue

    async def poll_now(self) -> None:
        async with self._poll_lock:
            await self._poll_once()

    async def _poll_once(self) -> None:
        try:
            tiles = await self.tile_client.list_tiles()
            updates: list[TileLocation] = []
            for tile in tiles:
                location = await self.tile_client.get_tile_location(tile.uuid, tile.name)
                if location:
                    updates.append(location)

            if updates:
                self.history_store.record(updates)

            if self.ws_manager.has_connections():
                latest = self.history_store.get_latest_locations()
                await self.ws_manager.broadcast(
                    {
                        "type": "tile_locations",
                        "items": [item.model_dump(mode="json") for item in latest],
                    }
                )
        except Exception as exc:
            LOGGER.exception("Tile polling error: %s", exc)
