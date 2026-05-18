from datetime import datetime

from pydantic import BaseModel


class TileSummary(BaseModel):
    uuid: str
    name: str


class TileLocation(BaseModel):
    tile_uuid: str
    latitude: float
    longitude: float
    observed_at: datetime
    label: str
