from fastapi import APIRouter, Request

from src.core.settings import HealthResponse, TileStatusResponse, get_settings

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
