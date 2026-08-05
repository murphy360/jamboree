import asyncio

from fastapi import APIRouter, HTTPException, Query, Request

from src.core.settings import HealthResponse, TileStatusResponse, get_settings
from src.services.models import (
    AreaMergeUndoState,
    CreateAreaRequest,
    CustomArea,
    LeaderboardResponse,
    MapFeature,
    MyMapsSyncResponse,
    TopAreasResponse,
    TileLocation,
    TileDetailsResponse,
    TileHistoryResponse,
    UpdateAreaRequest,
    UpdateAreaPolygonRequest,
)

router = APIRouter()
HISTORY_IO_TIMEOUT_SECONDS = 3
TILE_STATUS_TIMEOUT_SECONDS = 6
GLOBAL_AREA_STATS_TIMEOUT_SECONDS = 8


def _compute_global_area_stats(request: Request, areas: list[CustomArea]) -> list[CustomArea]:
    if not areas:
        return areas

    history_store = request.app.state.history_store
    area_store = request.app.state.area_store
    settings = get_settings()
    per_tile_limit = settings.tile_leaderboard_history_points_limit
    effective_limit = per_tile_limit if per_tile_limit > 0 else 2000

    aggregate_samples: dict[str, int] = {area.area_id: 0 for area in areas}
    aggregate_minutes: dict[str, int] = {area.area_id: 0 for area in areas}

    for tile_uuid, _label in history_store.get_all_tile_identifiers():
        history = history_store.get_history(tile_uuid, limit=effective_limit)
        if not history:
            continue
        stats = area_store.compute_area_stats(history, areas)
        for stat in stats:
            aggregate_samples[stat.area_id] = aggregate_samples.get(stat.area_id, 0) + stat.samples
            aggregate_minutes[stat.area_id] = aggregate_minutes.get(stat.area_id, 0) + stat.minutes_spent

    return [
        area.model_copy(
            update={
                "samples": aggregate_samples.get(area.area_id, 0),
                "minutes_spent": aggregate_minutes.get(area.area_id, 0),
            }
        )
        for area in areas
    ]


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    settings = get_settings()
    return HealthResponse(status="ok", app_name=settings.app_name)


@router.get("/debug/tile-status", response_model=TileStatusResponse)
async def tile_status(request: Request) -> TileStatusResponse:
    poller = request.app.state.poller
    ok, tile_count, detail = poller.get_source_status()
    return TileStatusResponse(ok=ok, tile_count=tile_count, detail=detail)


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
    poller = request.app.state.poller

    cached = poller.get_cached_latest_locations()
    if cached:
        return cached

    try:
        return await asyncio.wait_for(
            asyncio.to_thread(history_store.get_latest_locations),
            timeout=HISTORY_IO_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        return poller.get_cached_latest_locations()
    except Exception:
        return poller.get_cached_latest_locations()


@router.get("/tiles/{tile_uuid}/history", response_model=TileHistoryResponse)
async def tile_history(
    tile_uuid: str,
    request: Request,
    limit: int | None = Query(default=None, ge=1, le=50000),
    dedupe_consecutive: bool = Query(default=False),
    dedupe_tolerance_meters: float = Query(default=0.0, ge=0, le=200),
) -> TileHistoryResponse:
    history_store = request.app.state.history_store
    settings = get_settings()
    effective_limit = limit if limit is not None else settings.tile_history_api_default_limit

    try:
        summary = await asyncio.wait_for(
            asyncio.to_thread(history_store.get_history_summary, tile_uuid),
            timeout=HISTORY_IO_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Timed out loading tile history summary")
    total_points, _, _, latest_label = summary
    try:
        history = await asyncio.wait_for(
            asyncio.to_thread(history_store.get_history, tile_uuid, effective_limit),
            timeout=HISTORY_IO_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Timed out loading tile history")
    if not history:
        raise HTTPException(status_code=404, detail="Tile history not found")

    if dedupe_consecutive:
        history = history_store.dedupe_consecutive_points(history, dedupe_tolerance_meters)

    return TileHistoryResponse(
        tile_uuid=tile_uuid,
        label=latest_label or history[-1].label,
        total_points=total_points,
        returned_points=len(history),
        history_truncated=total_points > len(history),
        items=history,
    )


@router.get("/tiles/{tile_uuid}/details", response_model=TileDetailsResponse)
async def tile_details(
    tile_uuid: str,
    request: Request,
    dwell_merge_meters: float | None = Query(default=None, ge=5, le=500),
    history_limit: int | None = Query(default=None, ge=1, le=50000),
    dedupe_consecutive: bool = Query(default=False),
    dedupe_tolerance_meters: float = Query(default=0.0, ge=0, le=200),
) -> TileDetailsResponse:
    history_store = request.app.state.history_store
    area_store = request.app.state.area_store
    settings = get_settings()
    effective_limit = (
        history_limit if history_limit is not None else settings.tile_details_api_default_limit
    )
    try:
        summary = await asyncio.wait_for(
            asyncio.to_thread(history_store.get_history_summary, tile_uuid),
            timeout=HISTORY_IO_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Timed out loading tile details summary")
    total_points, first_observed_at, last_observed_at, latest_label = summary
    try:
        history = await asyncio.wait_for(
            asyncio.to_thread(history_store.get_history, tile_uuid, effective_limit),
            timeout=HISTORY_IO_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Timed out loading tile details history")
    if not history:
        raise HTTPException(status_code=404, detail="Tile history not found")

    if dedupe_consecutive:
        history = history_store.dedupe_consecutive_points(history, dedupe_tolerance_meters)

    merge_radius_meters = dwell_merge_meters or settings.tile_dwell_merge_radius_meters
    try:
        areas = await asyncio.wait_for(
            asyncio.to_thread(area_store.get_areas, tile_uuid),
            timeout=HISTORY_IO_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        areas = []
    areas_with_stats = area_store.compute_area_stats(history, areas)

    return TileDetailsResponse(
        tile_uuid=tile_uuid,
        label=latest_label or history[-1].label,
        total_points=total_points,
        returned_points=len(history),
        history_truncated=total_points > len(history),
        first_observed_at=first_observed_at or history[0].observed_at,
        last_observed_at=last_observed_at or history[-1].observed_at,
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

    try:
        areas = await asyncio.wait_for(
            asyncio.to_thread(area_store.get_areas, tile_uuid),
            timeout=HISTORY_IO_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        return []
    except Exception:
        return []

    # Global map overlays only need polygon geometry; skip heavy history scan here.
    if tile_uuid == "global":
        try:
            return await asyncio.wait_for(
                asyncio.to_thread(_compute_global_area_stats, request, areas),
                timeout=GLOBAL_AREA_STATS_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            return areas
        except Exception:
            return areas

    try:
        history = await asyncio.wait_for(
            asyncio.to_thread(history_store.get_history, tile_uuid),
            timeout=HISTORY_IO_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        return areas
    except Exception:
        return areas

    return area_store.compute_area_stats(history, areas)


@router.post("/tiles/{tile_uuid}/areas", response_model=CustomArea, status_code=201)
async def create_area(
    tile_uuid: str, body: CreateAreaRequest, request: Request
) -> CustomArea:
    area_store = request.app.state.area_store
    leaderboard_store = request.app.state.leaderboard_store
    settings = get_settings()
    if not body.merge_into_area_id and len(body.cluster_centers) < 3:
        raise HTTPException(
            status_code=422,
            detail="At least 3 cluster centers are required to define an area.",
        )
    try:
        if body.merge_into_area_id:
            merged = area_store.merge_area(
                tile_uuid=tile_uuid,
                merge_into_area_id=body.merge_into_area_id,
                cluster_centers=body.cluster_centers,
                hotspot_centers=body.hotspot_centers,
                merge_source_area_ids=body.merge_source_area_ids,
                hotspot_buffer_meters=settings.tile_area_hotspot_buffer_meters,
            )
            leaderboard_store.invalidate_cache()
            return merged
        created = area_store.create_area(tile_uuid, body.name, body.cluster_centers)
        leaderboard_store.invalidate_cache()
        return created
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/tiles/{tile_uuid}/areas/merge-undo", response_model=AreaMergeUndoState)
async def latest_merge_undo(tile_uuid: str, request: Request) -> AreaMergeUndoState:
    area_store = request.app.state.area_store
    latest = area_store.get_latest_merge_undo(tile_uuid)
    if not latest:
        raise HTTPException(status_code=404, detail="No merge is available to undo.")

    area_id, area_name, merged_at = latest
    return AreaMergeUndoState(area_id=area_id, area_name=area_name, merged_at=merged_at)


@router.post("/tiles/{tile_uuid}/areas/{area_id}/undo-merge", response_model=CustomArea)
async def undo_merge(tile_uuid: str, area_id: str, request: Request) -> CustomArea:
    area_store = request.app.state.area_store
    leaderboard_store = request.app.state.leaderboard_store
    try:
        restored = area_store.undo_merge(tile_uuid=tile_uuid, merge_into_area_id=area_id)
        leaderboard_store.invalidate_cache()
        return restored
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/map-features", response_model=list[MapFeature])
async def map_features(request: Request, tile_uuid: str = Query(default="global")) -> list[MapFeature]:
    feature_store = request.app.state.map_feature_store
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(feature_store.list_features, tile_uuid=tile_uuid),
            timeout=HISTORY_IO_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        return []
    except Exception:
        return []


@router.post("/imports/mymaps/sync", response_model=MyMapsSyncResponse)
async def sync_mymaps(request: Request) -> MyMapsSyncResponse:
    sync_service = request.app.state.mymaps_sync_service
    leaderboard_store = request.app.state.leaderboard_store
    try:
        result = await sync_service.sync_once()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"My Maps sync failed: {str(exc)[:280]}") from exc

    leaderboard_store.invalidate_cache()

    return MyMapsSyncResponse(
        source_url=result.source_url,
        tile_uuid=result.tile_uuid,
        folders_scanned=result.folders_scanned,
        polygons_imported=result.polygons_imported,
        features_imported=result.features_imported,
    )


@router.patch("/tiles/{tile_uuid}/areas/{area_id}", response_model=CustomArea)
async def rename_area(
    tile_uuid: str, area_id: str, body: UpdateAreaRequest, request: Request
) -> CustomArea:
    area_store = request.app.state.area_store
    leaderboard_store = request.app.state.leaderboard_store
    updated = area_store.update_area(area_id, body.name)
    if not updated:
        raise HTTPException(status_code=404, detail="Area not found")
    leaderboard_store.invalidate_cache()
    return updated


@router.patch("/tiles/{tile_uuid}/areas/{area_id}/polygon", response_model=CustomArea)
async def update_area_polygon(
    tile_uuid: str, area_id: str, body: UpdateAreaPolygonRequest, request: Request
) -> CustomArea:
    area_store = request.app.state.area_store
    leaderboard_store = request.app.state.leaderboard_store
    try:
        updated = area_store.update_area_polygon(area_id, body.polygon)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    if not updated:
        raise HTTPException(status_code=404, detail="Area not found")

    leaderboard_store.invalidate_cache()
    return updated


@router.delete("/tiles/{tile_uuid}/areas/{area_id}", status_code=204)
async def delete_area(tile_uuid: str, area_id: str, request: Request) -> None:
    area_store = request.app.state.area_store
    leaderboard_store = request.app.state.leaderboard_store
    if not area_store.delete_area(area_id):
        raise HTTPException(status_code=404, detail="Area not found")
    leaderboard_store.invalidate_cache()


@router.delete("/tiles/{tile_uuid}", status_code=204)
async def delete_tile(tile_uuid: str, request: Request) -> None:
    history_store = request.app.state.history_store
    area_store = request.app.state.area_store
    leaderboard_store = request.app.state.leaderboard_store

    deleted_history_rows = history_store.delete_tile_history(tile_uuid)
    area_store.delete_areas_for_tile(tile_uuid)
    if deleted_history_rows == 0:
        raise HTTPException(status_code=404, detail="Tile history not found")
    leaderboard_store.invalidate_cache()


@router.get("/leaderboard", response_model=LeaderboardResponse)
async def leaderboard(request: Request, date: str | None = Query(default=None)) -> LeaderboardResponse:
    leaderboard_store = request.app.state.leaderboard_store
    return leaderboard_store.get_leaderboard(date=date)


@router.get("/areas/top", response_model=TopAreasResponse)
async def top_areas(
    request: Request,
    date: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=200),
    area_tile_uuid: str = Query(default="global"),
) -> TopAreasResponse:
    leaderboard_store = request.app.state.leaderboard_store
    try:
        return leaderboard_store.get_top_areas(
            date=date,
            limit=limit,
            area_tile_uuid=area_tile_uuid,
        )
    except Exception:
        # Keep UI functional if one malformed area record or heavy query path fails.
        return TopAreasResponse(date=date, area_tile_uuid=area_tile_uuid, items=[])
