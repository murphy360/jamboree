from functools import lru_cache

from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    app_name: str = "jamboree-tracker-backend"
    tile_email: str = ""
    tile_password: str = ""
    tile_app_id: str = ""
    tile_app_version: str = ""
    tile_api_base_url: str = "https://production.tile-api.com/api/v1"
    home_assistant_url: str = "http://localhost:8123"
    home_assistant_token: str = ""
    home_assistant_tile_entities: str = ""
    home_assistant_exclude_entities: str = ""
    home_assistant_require_hash: bool = True
    home_assistant_tile_timestamp_offset_minutes: int = Field(default=0, ge=-720, le=720)
    tile_poll_interval_seconds: int = Field(default=15, ge=5, le=300)
    tile_history_db_path: str = "/app/data/tile_history.db"
    tile_history_max_points_per_tile: int = Field(default=0, ge=0, le=20000)
    tile_history_api_default_limit: int = Field(default=7000, ge=0, le=50000)
    tile_details_api_default_limit: int = Field(default=7000, ge=0, le=50000)
    tile_leaderboard_history_points_limit: int = Field(default=5000, ge=0, le=50000)
    tile_leaderboard_cache_ttl_seconds: int = Field(default=20, ge=0, le=600)
    tile_dwell_merge_radius_meters: int = Field(default=50, ge=5, le=500)
    tile_area_hotspot_buffer_meters: int = Field(default=50, ge=0, le=500)
    backend_cors_origins: str = "*"
    mymaps_import_enabled: bool = True
    mymaps_import_startup_only: bool = True
    mymaps_import_startup_marker_name: str = "mymaps_import_startup.done"
    mymaps_import_tile_uuid: str = "global"
    mymaps_kml_url: str = (
        "https://www.google.com/maps/d/kml?mid=1ZZEHtl-b2MjqlONDJMxWRzS0y3AzSqI&forcekml=1"
    )
    mymaps_import_interval_seconds: int = Field(default=900, ge=60, le=86400)
    mymaps_polygon_exclude_prefixes: str = "feature"
    mymaps_polygon_merge_rules: str = "BARR:Barrels,BOWS:Bows,PARK:Park,POOL:The Pools,D1:Subcamp_D1"


class HealthResponse(BaseModel):
    status: str
    app_name: str


class TileStatusResponse(BaseModel):
    ok: bool
    tile_count: int = 0
    detail: str


@lru_cache
def get_settings() -> Settings:
    return Settings()
