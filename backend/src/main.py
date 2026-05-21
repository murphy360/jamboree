import asyncio

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from src.api.routes import router
from src.core.settings import get_settings
from src.services.area_store import AreaStore
from src.services.home_assistant_client import HomeAssistantTileClient
from src.services.history_store import TileHistoryStore
from src.services.leaderboard_store import LeaderboardStore
from src.services.poller import TilePoller
from src.services.ws_manager import WebSocketManager

settings = get_settings()
app = FastAPI(title=settings.app_name)

# Parse CORS origins - supports both "*" and comma-separated list
cors_origins = [origin.strip() for origin in settings.backend_cors_origins.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins if "*" not in cors_origins else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
ws_manager = WebSocketManager()
history_store = TileHistoryStore(
    db_path=settings.tile_history_db_path,
    max_points_per_tile=settings.tile_history_max_points_per_tile,
)
tile_client = HomeAssistantTileClient(
    base_url=settings.home_assistant_url,
    token=settings.home_assistant_token,
    tile_entities=settings.home_assistant_tile_entities,
    exclude_entities=settings.home_assistant_exclude_entities,
    require_hash=settings.home_assistant_require_hash,
    timestamp_offset_minutes=settings.home_assistant_tile_timestamp_offset_minutes,
)
app.state.tile_client = tile_client
app.state.history_store = history_store
app.state.area_store = AreaStore(db_path=settings.tile_history_db_path)
app.state.leaderboard_store = LeaderboardStore(
    history_store=history_store,
    area_store=app.state.area_store,
)
poller = TilePoller(tile_client, ws_manager, history_store, settings.tile_poll_interval_seconds)
app.state.poller = poller
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
    history_store.close()


@app.websocket("/ws/locations")
async def locations_ws(websocket: WebSocket) -> None:
    await ws_manager.connect(websocket)
    latest = history_store.get_latest_locations()
    await websocket.send_json(
        {
            "type": "tile_locations",
            "items": [item.model_dump(mode="json") for item in latest],
        }
    )
    try:
        while True:
            # Keep the socket alive; frontend may send pings.
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
