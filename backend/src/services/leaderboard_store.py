"""Leaderboard computations: distance travelled and time in camp areas."""

from __future__ import annotations

from src.services.area_store import AreaStore
from src.services.history_store import TileHistoryStore, _haversine_meters
from src.services.models import LeaderboardEntry, LeaderboardResponse


class LeaderboardStore:
    def __init__(self, history_store: TileHistoryStore, area_store: AreaStore) -> None:
        self._history_store = history_store
        self._area_store = area_store

    def get_leaderboard(self, date: str | None = None) -> LeaderboardResponse:
        tile_ids = self._history_store.get_all_tile_identifiers()
        return LeaderboardResponse(
            date=date,
            distance=self._compute_distance_entries(tile_ids, date),
            camp_time=self._compute_camp_time_entries(tile_ids, date),
        )

    def _compute_distance_entries(
        self,
        tile_ids: list[tuple[str, str]],
        date: str | None,
    ) -> list[LeaderboardEntry]:
        results: list[tuple[str, str, float]] = []

        for tile_uuid, label in tile_ids:
            history = self._history_store.get_history(tile_uuid)
            if date:
                history = [p for p in history if p.observed_at.date().isoformat() == date]

            distance_m = 0.0
            for i in range(len(history) - 1):
                distance_m += _haversine_meters(
                    history[i].latitude,
                    history[i].longitude,
                    history[i + 1].latitude,
                    history[i + 1].longitude,
                )

            if distance_m > 0:
                results.append((tile_uuid, label, distance_m))

        results.sort(key=lambda x: x[2], reverse=True)
        return [
            LeaderboardEntry(rank=i + 1, tile_uuid=r[0], label=r[1], value=round(r[2], 1))
            for i, r in enumerate(results)
        ]

    def _compute_camp_time_entries(
        self,
        tile_ids: list[tuple[str, str]],
        date: str | None,
    ) -> list[LeaderboardEntry]:
        results: list[tuple[str, str, int]] = []

        for tile_uuid, label in tile_ids:
            areas = self._area_store.get_areas(tile_uuid)
            camp_areas = [a for a in areas if "camp" in a.name.lower()]
            if not camp_areas:
                continue

            history = self._history_store.get_history(tile_uuid)
            if date:
                history = [p for p in history if p.observed_at.date().isoformat() == date]
            if not history:
                continue

            stats = self._area_store.compute_area_stats(history, camp_areas)
            total_minutes = sum(a.minutes_spent for a in stats)
            if total_minutes > 0:
                results.append((tile_uuid, label, total_minutes))

        results.sort(key=lambda x: x[2], reverse=True)
        return [
            LeaderboardEntry(rank=i + 1, tile_uuid=r[0], label=r[1], value=float(r[2]))
            for i, r in enumerate(results)
        ]
