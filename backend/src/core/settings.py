from functools import lru_cache

from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    app_name: str = "jamboree-tracker-backend"
    tile_email: str = ""
    tile_password: str = ""
    tile_api_base_url: str = "https://production.tile-api.com/api/v1"
    tile_poll_interval_seconds: int = Field(default=15, ge=5, le=300)
    backend_cors_origins: str = "http://localhost:5173"


class HealthResponse(BaseModel):
    status: str
    app_name: str


@lru_cache
def get_settings() -> Settings:
    return Settings()
