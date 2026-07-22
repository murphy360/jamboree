import asyncio
import logging

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware

from src.api.routes import router
from src.core.settings import get_settings
from src.services.area_store import AreaStore
from src.services.home_assistant_client import HomeAssistantTileClient
from src.services.history_store import TileHistoryStore
from src.services.leaderboard_store import LeaderboardStore
from src.services.map_feature_store import MapFeatureStore
from src.services.mymaps_sync import MyMapsSyncService
from src.services.poller import TilePoller
from src.services.ws_manager import WebSocketManager

LOGGER = logging.getLogger(__name__)
settings = get_settings()
app = FastAPI(title=settings.app_name)
WS_INITIAL_SNAPSHOT_TIMEOUT_SECONDS = 3

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
app.state.map_feature_store = MapFeatureStore(db_path=settings.tile_history_db_path)
app.state.leaderboard_store = LeaderboardStore(
    history_store=history_store,
    area_store=app.state.area_store,
)
poller = TilePoller(tile_client, ws_manager, history_store, settings.tile_poll_interval_seconds)
app.state.poller = poller
mymaps_sync_service = MyMapsSyncService(
    area_store=app.state.area_store,
    map_feature_store=app.state.map_feature_store,
    kml_url=settings.mymaps_kml_url,
    tile_uuid=settings.mymaps_import_tile_uuid,
    interval_seconds=settings.mymaps_import_interval_seconds,
    enabled=settings.mymaps_import_enabled,
)
app.state.mymaps_sync_service = mymaps_sync_service
poller_task: asyncio.Task | None = None
mymaps_sync_task: asyncio.Task | None = None


@app.on_event("startup")
async def startup() -> None:
    global poller_task, mymaps_sync_task
    print(f"=== STARTUP: Starting poller with interval: {settings.tile_poll_interval_seconds}s")
    print(f"=== STARTUP: Home Assistant URL: {settings.home_assistant_url}")
    print(f"=== STARTUP: Require hash: {settings.home_assistant_require_hash}")
    print(f"=== STARTUP: Tile entities filter: {settings.home_assistant_tile_entities}")
    poller_task = asyncio.create_task(poller.run())
    print("=== STARTUP: Poller task started")
    if settings.mymaps_import_enabled:
        print(
            "=== STARTUP: My Maps sync enabled "
            f"interval={settings.mymaps_import_interval_seconds}s"
        )
        mymaps_sync_task = asyncio.create_task(mymaps_sync_service.run())


@app.on_event("shutdown")
async def shutdown() -> None:
    if mymaps_sync_task:
        await mymaps_sync_service.stop()
        mymaps_sync_task.cancel()
    if poller_task:
        await poller.stop()
        poller_task.cancel()
    history_store.close()


@app.websocket("/ws/locations")
async def locations_ws(websocket: WebSocket) -> None:
    from datetime import datetime
    now = datetime.now().strftime("%H:%M:%S")
    print(f"[{now}] === WS: Handler started, websocket.client={websocket.client}", flush=True)
    try:
        print(f"[{now}] === WS: About to call ws_manager.connect()", flush=True)
        await ws_manager.connect(websocket)
        now = datetime.now().strftime("%H:%M:%S")
        print(f"[{now}] === WS: ws_manager.connect() succeeded", flush=True)

        # Send the latest stored locations immediately so the UI does not wait for the next poll.
        now = datetime.now().strftime("%H:%M:%S")
        print(f"[{now}] === WS: Sending initial latest locations message", flush=True)
        try:
            latest_locations = await asyncio.wait_for(
                asyncio.to_thread(history_store.get_latest_locations),
                timeout=WS_INITIAL_SNAPSHOT_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            latest_locations = []
        await websocket.send_json({
            "type": "tile_locations",
            "items": jsonable_encoder(latest_locations),
        })
        now = datetime.now().strftime("%H:%M:%S")
        print(f"[{now}] === WS: Initial latest locations message sent successfully", flush=True)
        
        now = datetime.now().strftime("%H:%M:%S")
        print(f"[{now}] === WS: Entering receive loop", flush=True)
        while True:
            # Keep the socket alive; frontend may send pings.
            msg = await websocket.receive_text()
            now = datetime.now().strftime("%H:%M:%S")
            print(f"[{now}] === WS: Received message: {msg}", flush=True)
    except WebSocketDisconnect:
        now = datetime.now().strftime("%H:%M:%S")
        print(f"[{now}] === WS: WebSocketDisconnect (normal closure)", flush=True)
        try:
            ws_manager.disconnect(websocket)
        except Exception as e:
            now = datetime.now().strftime("%H:%M:%S")
            print(f"[{now}] === WS: Error disconnecting: {e}", flush=True)
    except Exception as e:
        now = datetime.now().strftime("%H:%M:%S")
        print(f"[{now}] === WS ERROR: {type(e).__name__}: {e}", flush=True)
        import traceback
        print(traceback.format_exc(), flush=True)
        LOGGER.exception("WebSocket error: %s", e)
        try:
            ws_manager.disconnect(websocket)
        except Exception:
            pass
