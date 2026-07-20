import asyncio

from fastapi import APIRouter, HTTPException, Query, Request

from src.core.settings import HealthResponse, TileStatusResponse, get_settings
from src.services.models import (
    CreateAreaRequest,
    CustomArea,
    GisLayerImportRequest,
    GisLayerImportResponse,
    LeaderboardResponse,
    TileLocation,
    TileDetailsResponse,
    TileHistoryResponse,
    UpdateAreaRequest,
)
from src.services.gis_importer import GisImporter

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


@router.get("/locations/latest", response_model=list[TileLocation])
async def latest_locations(request: Request) -> list[TileLocation]:
    history_store = request.app.state.history_store
    return await asyncio.to_thread(history_store.get_latest_locations)


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
    area_store = request.app.state.area_store
    settings = get_settings()
    history = history_store.get_history(tile_uuid)
    if not history:
        raise HTTPException(status_code=404, detail="Tile history not found")

    merge_radius_meters = dwell_merge_meters or settings.tile_dwell_merge_radius_meters
    areas = area_store.get_areas(tile_uuid)
    areas_with_stats = area_store.compute_area_stats(history, areas)

    return TileDetailsResponse(
        tile_uuid=tile_uuid,
        label=history[-1].label,
        total_points=len(history),
        first_observed_at=history[0].observed_at,
        last_observed_at=history[-1].observed_at,
        items=history,
        daily_breakdown=history_store.build_daily_breakdown(history),
        dwell_clusters=history_store.build_dwell_clusters(
            history, merge_radius_meters=merge_radius_meters, areas=areas
        ),
        custom_areas=areas_with_stats,
    )


@router.get("/tiles/{tile_uuid}/areas", response_model=list[CustomArea])
async def list_areas(tile_uuid: str, request: Request) -> list[CustomArea]:
    area_store = request.app.state.area_store
    history_store = request.app.state.history_store
    areas = area_store.get_areas(tile_uuid)
    history = history_store.get_history(tile_uuid)
    return area_store.compute_area_stats(history, areas)


@router.post("/tiles/{tile_uuid}/areas", response_model=CustomArea, status_code=201)
async def create_area(
    tile_uuid: str, body: CreateAreaRequest, request: Request
) -> CustomArea:
    area_store = request.app.state.area_store
    settings = get_settings()
    if not body.merge_into_area_id and len(body.cluster_centers) < 3:
        raise HTTPException(
            status_code=422,
            detail="At least 3 cluster centers are required to define an area.",
        )
    try:
        if body.merge_into_area_id:
            return area_store.merge_area(
                tile_uuid=tile_uuid,
                merge_into_area_id=body.merge_into_area_id,
                cluster_centers=body.cluster_centers,
                hotspot_centers=body.hotspot_centers,
                merge_source_area_ids=body.merge_source_area_ids,
                hotspot_buffer_meters=settings.tile_area_hotspot_buffer_meters,
            )
        return area_store.create_area(tile_uuid, body.name, body.cluster_centers)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/gis/import", response_model=GisLayerImportResponse)
async def import_gis_layer(body: GisLayerImportRequest, request: Request) -> GisLayerImportResponse:
    area_store = request.app.state.area_store
    importer = GisImporter(area_store)

    try:
        result = await importer.import_arcgis_layer(
            layer_name=body.layer_name,
            service_url=body.service_url,
            tile_uuid=body.tile_uuid,
            layer_index=body.layer_index,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"GIS import failed: {str(exc)[:280]}") from exc

    return GisLayerImportResponse(
        layer_name=result.layer_name,
        service_url=result.service_url,
        tile_uuid=result.tile_uuid,
        imported=result.imported,
        updated=result.updated,
        skipped=result.skipped,
    )


@router.patch("/tiles/{tile_uuid}/areas/{area_id}", response_model=CustomArea)
async def rename_area(
    tile_uuid: str, area_id: str, body: UpdateAreaRequest, request: Request
) -> CustomArea:
    area_store = request.app.state.area_store
    updated = area_store.update_area(area_id, body.name)
    if not updated:
        raise HTTPException(status_code=404, detail="Area not found")
    return updated


@router.delete("/tiles/{tile_uuid}/areas/{area_id}", status_code=204)
async def delete_area(tile_uuid: str, area_id: str, request: Request) -> None:
    area_store = request.app.state.area_store
    if not area_store.delete_area(area_id):
        raise HTTPException(status_code=404, detail="Area not found")


@router.delete("/tiles/{tile_uuid}", status_code=204)
async def delete_tile(tile_uuid: str, request: Request) -> None:
    history_store = request.app.state.history_store
    area_store = request.app.state.area_store

    deleted_history_rows = history_store.delete_tile_history(tile_uuid)
    area_store.delete_areas_for_tile(tile_uuid)
    if deleted_history_rows == 0:
        raise HTTPException(status_code=404, detail="Tile history not found")


@router.get("/leaderboard", response_model=LeaderboardResponse)
async def leaderboard(request: Request, date: str | None = Query(default=None)) -> LeaderboardResponse:
    leaderboard_store = request.app.state.leaderboard_store
    return leaderboard_store.get_leaderboard(date=date)
