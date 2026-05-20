from fastapi import APIRouter, HTTPException, Query, Request

from src.core.settings import HealthResponse, TileStatusResponse, get_settings
from src.services.models import TileDetailsResponse, TileHistoryResponse

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    settings = get_settings()
    return HealthResponse(status="ok", app_name=settings.app_name)


@router.get("/debug/tile-status", response_model=TileStatusResponse)
async def tile_status(request: Request) -> TileStatusResponse:
    tile_client = request.app.state.tile_client
    try:
        tiles = await tile_client.list_tiles()
        return TileStatusResponse(ok=True, tile_count=len(tiles), detail="Tracker source reachable")
    except Exception as exc:
        return TileStatusResponse(
            ok=False,
            tile_count=0,
            detail=f"Tile API error: {str(exc)[:280]}",
        )


@router.get("/debug/tile-timestamps")
async def tile_timestamps(request: Request) -> dict:
    tile_client = request.app.state.tile_client
    if not hasattr(tile_client, "debug_tile_timestamps"):
        raise HTTPException(status_code=501, detail="Timestamp debug is not supported for this tile client")

    try:
        items = await tile_client.debug_tile_timestamps()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Unable to inspect tile timestamp payloads: {str(exc)[:280]}") from exc

    return {"count": len(items), "items": items}


@router.get("/tiles/{tile_uuid}/history", response_model=TileHistoryResponse)
async def tile_history(tile_uuid: str, request: Request) -> TileHistoryResponse:
    history_store = request.app.state.history_store
    history = history_store.get_history(tile_uuid)
    if not history:
        raise HTTPException(status_code=404, detail="Tile history not found")

    return TileHistoryResponse(tile_uuid=tile_uuid, label=history[-1].label, items=history)


@router.get("/tiles/{tile_uuid}/details", response_model=TileDetailsResponse)
async def tile_details(
    tile_uuid: str,
    request: Request,
    dwell_merge_meters: float | None = Query(default=None, ge=5, le=500),
) -> TileDetailsResponse:
    history_store = request.app.state.history_store
    settings = get_settings()
    history = history_store.get_history(tile_uuid)
    if not history:
        raise HTTPException(status_code=404, detail="Tile history not found")

    merge_radius_meters = dwell_merge_meters or settings.tile_dwell_merge_radius_meters

    return TileDetailsResponse(
        tile_uuid=tile_uuid,
        label=history[-1].label,
        total_points=len(history),
        first_observed_at=history[0].observed_at,
        last_observed_at=history[-1].observed_at,
        items=history,
        daily_breakdown=history_store.build_daily_breakdown(history),
        dwell_clusters=history_store.build_dwell_clusters(history, merge_radius_meters=merge_radius_meters),
    )
