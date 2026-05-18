import asyncio
import logging

from src.services.tile_client import TileClient
from src.services.ws_manager import WebSocketManager

LOGGER = logging.getLogger(__name__)


class TilePoller:
    def __init__(self, tile_client: TileClient, ws_manager: WebSocketManager, interval_seconds: int) -> None:
        self.tile_client = tile_client
        self.ws_manager = ws_manager
        self.interval_seconds = interval_seconds
        self._shutdown = asyncio.Event()

    async def stop(self) -> None:
        self._shutdown.set()

    async def run(self) -> None:
        while not self._shutdown.is_set():
            await self._poll_once()
            try:
                await asyncio.wait_for(self._shutdown.wait(), timeout=self.interval_seconds)
            except TimeoutError:
                continue

    async def _poll_once(self) -> None:
        if not self.ws_manager.has_connections():
            return

        try:
            tiles = await self.tile_client.list_tiles()
            updates = []
            for tile in tiles:
                location = await self.tile_client.get_tile_location(tile.uuid, tile.name)
                if location:
                    updates.append(location.model_dump(mode="json"))

            if updates:
                await self.ws_manager.broadcast({"type": "tile_locations", "items": updates})
        except Exception as exc:
            LOGGER.exception("Tile polling error: %s", exc)
