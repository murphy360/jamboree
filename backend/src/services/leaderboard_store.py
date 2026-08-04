"""Leaderboard computations for distance and time spent in named area types."""

from __future__ import annotations

from threading import Lock
from time import monotonic

from src.services.area_store import AreaStore
from src.services.history_store import TileHistoryStore, _haversine_meters
from src.services.models import LeaderboardEntry, LeaderboardResponse


class LeaderboardStore:
    def __init__(
        self,
        history_store: TileHistoryStore,
        area_store: AreaStore,
        history_points_limit: int = 0,
        cache_ttl_seconds: int = 20,
    ) -> None:
        self._history_store = history_store
        self._area_store = area_store
        self._history_points_limit = history_points_limit
        self._cache_ttl_seconds = max(0, cache_ttl_seconds)
        self._cache_lock = Lock()
        self._cache: dict[str, tuple[float, LeaderboardResponse]] = {}

    def invalidate_cache(self) -> None:
        with self._cache_lock:
            self._cache.clear()

    def get_leaderboard(self, date: str | None = None) -> LeaderboardResponse:
        cache_key = date or "__overall__"
        if self._cache_ttl_seconds > 0:
            with self._cache_lock:
                cached = self._cache.get(cache_key)
                if cached:
                    cached_at, cached_response = cached
                    if monotonic() - cached_at <= self._cache_ttl_seconds:
                        return cached_response.model_copy(deep=True)

        tile_ids = self._history_store.get_all_tile_identifiers()
        distance_results: list[tuple[str, str, float]] = []
        camp_time_results: list[tuple[str, str, int]] = []
        patch_time_results: list[tuple[str, str, int]] = []

        for tile_uuid, label in tile_ids:
            history = self._history_store.get_history(
                tile_uuid,
                limit=self._history_points_limit if self._history_points_limit > 0 else None,
            )
            if date:
                history = [p for p in history if p.observed_at.date().isoformat() == date]

            if history:
                distance_m = self._compute_distance_meters(history)
                if distance_m > 0:
                    distance_results.append((tile_uuid, label, distance_m))

            areas = self._area_store.get_areas(tile_uuid)
            if not history or not areas:
                continue

            matching_camp_areas = [a for a in areas if self._is_camp_area(a.name.lower())]
            if matching_camp_areas:
                stats = self._area_store.compute_area_stats(history, matching_camp_areas)
                total_minutes = sum(a.minutes_spent for a in stats)
                if total_minutes > 0:
                    camp_time_results.append((tile_uuid, label, total_minutes))

            matching_patch_areas = [a for a in areas if self._is_patch_trading_area(a.name.lower())]
            if matching_patch_areas:
                stats = self._area_store.compute_area_stats(history, matching_patch_areas)
                total_minutes = sum(a.minutes_spent for a in stats)
                if total_minutes > 0:
                    patch_time_results.append((tile_uuid, label, total_minutes))

        response = LeaderboardResponse(
            date=date,
            distance=self._rank_float_entries(distance_results),
            camp_time=self._rank_int_entries(camp_time_results),
            patch_trading_time=self._rank_int_entries(patch_time_results),
        )

        if self._cache_ttl_seconds > 0:
            with self._cache_lock:
                self._cache[cache_key] = (monotonic(), response.model_copy(deep=True))

        return response

    def _compute_distance_meters(self, history) -> float:
        distance_m = 0.0
        for i in range(len(history) - 1):
            distance_m += _haversine_meters(
                history[i].latitude,
                history[i].longitude,
                history[i + 1].latitude,
                history[i + 1].longitude,
            )
        return distance_m

    def _rank_float_entries(self, results: list[tuple[str, str, float]]) -> list[LeaderboardEntry]:
        results.sort(key=lambda x: x[2], reverse=True)
        return [
            LeaderboardEntry(rank=i + 1, tile_uuid=r[0], label=r[1], value=round(r[2], 1))
            for i, r in enumerate(results)
        ]

    def _rank_int_entries(self, results: list[tuple[str, str, int]]) -> list[LeaderboardEntry]:
        results.sort(key=lambda x: x[2], reverse=True)
        return [
            LeaderboardEntry(rank=i + 1, tile_uuid=r[0], label=r[1], value=float(r[2]))
            for i, r in enumerate(results)
        ]

    def _is_patch_trading_area(self, area_name: str) -> bool:
        if "patch trading" in area_name:
            return True
        return "patch" in area_name and ("trade" in area_name or "trading" in area_name)

    def _is_camp_area(self, area_name: str) -> bool:
        # Camp leaderboard currently scopes only to Subcamp C1.
        return area_name.strip() == "subcamp c1"
