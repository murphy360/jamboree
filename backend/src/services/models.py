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
    items: list[TileLocation]
