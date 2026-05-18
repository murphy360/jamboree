import asyncio

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from src.api.routes import router
from src.core.settings import get_settings
from src.services.home_assistant_client import HomeAssistantTileClient
from src.services.poller import TilePoller
from src.services.ws_manager import WebSocketManager

settings = get_settings()
app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.backend_cors_origins.split(",") if origin.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
ws_manager = WebSocketManager()
tile_client = HomeAssistantTileClient(
    base_url=settings.home_assistant_url,
    token=settings.home_assistant_token,
    tile_entities=settings.home_assistant_tile_entities,
    exclude_entities=settings.home_assistant_exclude_entities,
)
app.state.tile_client = tile_client
poller = TilePoller(tile_client, ws_manager, settings.tile_poll_interval_seconds)
poller_task: asyncio.Task | None = None


@app.on_event("startup")
async def startup() -> None:
    global poller_task
    poller_task = asyncio.create_task(poller.run())


@app.on_event("shutdown")
async def shutdown() -> None:
    if poller_task:
        await poller.stop()
        poller_task.cancel()


@app.websocket("/ws/locations")
async def locations_ws(websocket: WebSocket) -> None:
    await ws_manager.connect(websocket)
    try:
        while True:
            # Keep the socket alive; frontend may send pings.
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
