import asyncio
import logging
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

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
ONE_SHOT_RESET_TZ = ZoneInfo("America/New_York")
ONE_SHOT_RESETS = [
    ("20260721_1945_edt_test", datetime(2026, 7, 21, 19, 45, tzinfo=ONE_SHOT_RESET_TZ)),
    ("20260722_0630_edt", datetime(2026, 7, 22, 6, 30, tzinfo=ONE_SHOT_RESET_TZ)),
]


def _parse_polygon_merge_rules(value: str) -> list[tuple[str, str]]:
    rules: list[tuple[str, str]] = []
    for chunk in value.split(","):
        token = chunk.strip()
        if not token or ":" not in token:
            continue
        source_prefix, target_name = token.split(":", 1)
        source_prefix = source_prefix.strip()
        target_name = target_name.strip()
        if source_prefix and target_name:
            rules.append((source_prefix, target_name))
    return rules

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
    history_points_limit=settings.tile_leaderboard_history_points_limit,
    cache_ttl_seconds=settings.tile_leaderboard_cache_ttl_seconds,
)
poller = TilePoller(
    tile_client,
    ws_manager,
    history_store,
    settings.tile_poll_interval_seconds,
    on_history_updated=app.state.leaderboard_store.invalidate_cache,
)
app.state.poller = poller
mymaps_sync_service = MyMapsSyncService(
    area_store=app.state.area_store,
    map_feature_store=app.state.map_feature_store,
    kml_url=settings.mymaps_kml_url,
    tile_uuid=settings.mymaps_import_tile_uuid,
    interval_seconds=settings.mymaps_import_interval_seconds,
    enabled=settings.mymaps_import_enabled,
    polygon_exclude_prefixes=settings.mymaps_polygon_exclude_prefixes.split(","),
    polygon_merge_rules=_parse_polygon_merge_rules(settings.mymaps_polygon_merge_rules),
)
app.state.mymaps_sync_service = mymaps_sync_service
poller_task: asyncio.Task | None = None
mymaps_sync_task: asyncio.Task | None = None
one_shot_reset_task: asyncio.Task | None = None
one_shot_reset_shutdown = asyncio.Event()


async def run_one_shot_tracker_reset() -> None:
    for reset_key, reset_at in sorted(ONE_SHOT_RESETS, key=lambda item: item[1]):
        marker_path = Path(settings.tile_history_db_path).with_name(f"tracker_reset_{reset_key}.done")
        if marker_path.exists():
            LOGGER.info("One-shot tracker reset skipped; marker exists at %s", marker_path)
            continue

        now = datetime.now(ONE_SHOT_RESET_TZ)
        delay_seconds = (reset_at - now).total_seconds()
        if delay_seconds > 0:
            LOGGER.info(
                "One-shot tracker reset scheduled for %s (%ss from now)",
                reset_at.isoformat(),
                int(delay_seconds),
            )
            try:
                await asyncio.wait_for(one_shot_reset_shutdown.wait(), timeout=delay_seconds)
                return
            except asyncio.TimeoutError:
                pass

        deleted_rows = await asyncio.to_thread(history_store.delete_all_history)
        poller.clear_cached_latest_locations()
        app.state.leaderboard_store.invalidate_cache()
        marker_path.parent.mkdir(parents=True, exist_ok=True)
        marker_path.write_text(datetime.now(ONE_SHOT_RESET_TZ).isoformat(), encoding="utf-8")
        LOGGER.warning(
            "One-shot tracker reset executed for %s; deleted_history_rows=%s",
            reset_key,
            deleted_rows,
        )

        if ws_manager.has_connections():
            await ws_manager.broadcast({"type": "tile_locations", "items": []})


@app.on_event("startup")
async def startup() -> None:
    global poller_task, mymaps_sync_task, one_shot_reset_task
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
    one_shot_reset_shutdown.clear()
    one_shot_reset_task = asyncio.create_task(run_one_shot_tracker_reset())


@app.on_event("shutdown")
async def shutdown() -> None:
    one_shot_reset_shutdown.set()
    if one_shot_reset_task:
        one_shot_reset_task.cancel()
    if mymaps_sync_task:
        await mymaps_sync_service.stop()
        mymaps_sync_task.cancel()
    if poller_task:
        await poller.stop()
        poller_task.cancel()
    app.state.map_feature_store.close()
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
        latest_locations = poller.get_cached_latest_locations()
        if not latest_locations:
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
