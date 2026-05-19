from __future__ import annotations

from collections import deque
from typing import Deque

from src.services.models import TileLocation


class TileHistoryStore:
    def __init__(self, max_points_per_tile: int = 100) -> None:
        self._max_points_per_tile = max_points_per_tile
        self._history: dict[str, Deque[TileLocation]] = {}

    def record(self, locations: list[TileLocation]) -> None:
        for location in locations:
            history = self._history.get(location.tile_uuid)
            if history is None:
                history = deque(maxlen=self._max_points_per_tile)
                self._history[location.tile_uuid] = history

            last_location = history[-1] if history else None
            if last_location and last_location.observed_at.replace(microsecond=0) == location.observed_at.replace(
                microsecond=0
            ):
                continue

            history.append(location)

    def get_history(self, tile_uuid: str) -> list[TileLocation]:
        history = self._history.get(tile_uuid)
        if not history:
            return []
        return list(history)
