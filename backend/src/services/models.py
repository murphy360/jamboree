from datetime import UTC, datetime

from pydantic import BaseModel, field_validator


class TileSummary(BaseModel):
    uuid: str
    name: str


class TileLocation(BaseModel):
    tile_uuid: str
    latitude: float
    longitude: float
    observed_at: datetime
    label: str
    tile_service_observed_at: datetime | None = None
    polled_at: datetime | None = None

    @field_validator("observed_at", "tile_service_observed_at", "polled_at", mode="before")
    @classmethod
    def _normalize_to_utc(cls, value: datetime | str | None) -> datetime | None:
        if value is None:
            return None

        parsed = value
        if isinstance(value, str):
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))

        if not isinstance(parsed, datetime):
            raise TypeError("Expected datetime-compatible value")

        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=UTC)

        return parsed.astimezone(UTC)


class TileHistoryResponse(BaseModel):
    tile_uuid: str
    label: str
    total_points: int
    returned_points: int
    history_truncated: bool = False
    items: list[TileLocation]


class TileDailySummary(BaseModel):
    date: str
    point_count: int
    start_observed_at: datetime
    end_observed_at: datetime
    total_span_minutes: int


class TileDwellCluster(BaseModel):
    latitude: float
    longitude: float
    samples: int
    minutes_spent: int


class AreaPolygonPoint(BaseModel):
    latitude: float
    longitude: float


class CustomArea(BaseModel):
    area_id: str
    tile_uuid: str
    name: str
    polygon: list[AreaPolygonPoint]
    samples: int = 0
    minutes_spent: int = 0
    created_at: datetime
    updated_at: datetime
    source_type: str = "manual"
    source_name: str | None = None
    source_url: str | None = None
    source_feature_id: str | None = None


class CreateAreaRequest(BaseModel):
    name: str
    cluster_centers: list[AreaPolygonPoint]
    hotspot_centers: list[AreaPolygonPoint] = []
    merge_into_area_id: str | None = None


class MapFeature(BaseModel):
    id: str | None = None
    tile_uuid: str = "global"
    name: str
    folder_name: str | None = None
    geometry_type: str
    geometry: list | dict
    source_type: str = "manual"
    source_name: str | None = None
    source_url: str | None = None
    source_feature_id: str | None = None


class MyMapsSyncResponse(BaseModel):
    source_url: str
    tile_uuid: str
    folders_scanned: int
    polygons_imported: int
    features_imported: int


class LeaderboardEntry(BaseModel):
    rank: int
    tile_uuid: str
    label: str
    value: float


class LeaderboardResponse(BaseModel):
    date: str | None
    distance: list[LeaderboardEntry]
    camp_time: list[LeaderboardEntry]
    patch_trading_time: list[LeaderboardEntry]


class UpdateAreaRequest(BaseModel):
    name: str


class TileDetailsResponse(BaseModel):
    tile_uuid: str
    label: str
    total_points: int
    returned_points: int
    history_truncated: bool = False
    first_observed_at: datetime
    last_observed_at: datetime
    items: list[TileLocation]
    daily_breakdown: list[TileDailySummary]
    dwell_clusters: list[TileDwellCluster]
    custom_areas: list[CustomArea] = []
