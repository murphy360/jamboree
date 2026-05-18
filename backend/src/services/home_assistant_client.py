from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import httpx

from src.services.models import TileLocation, TileSummary


class HomeAssistantTileClient:
    def __init__(
        self,
        base_url: str,
        token: str,
        tile_entities: str = "",
        exclude_entities: str = "",
        require_hash: bool = True,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.entity_filter = [item.strip() for item in tile_entities.split(",") if item.strip()]
        self.entity_exclude = {item.strip() for item in exclude_entities.split(",") if item.strip()}
        self.require_hash = require_hash
        self._state_cache: dict[str, dict[str, Any]] = {}

    def _headers(self) -> dict[str, str]:
        if not self.token:
            raise RuntimeError(
                "HOME_ASSISTANT_TOKEN is missing. Create a Long-Lived Access Token in Home Assistant."
            )
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

    async def _fetch_states(self) -> list[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get(f"{self.base_url}/api/states", headers=self._headers())
            response.raise_for_status()
            data = response.json()

        if isinstance(data, list):
            return [item for item in data if isinstance(item, dict)]
        return []

    async def _fetch_state(self, entity_id: str) -> dict[str, Any] | None:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get(
                f"{self.base_url}/api/states/{entity_id}",
                headers=self._headers(),
            )
            if response.status_code == 404:
                return None
            response.raise_for_status()
            data = response.json()

        return data if isinstance(data, dict) else None

    @staticmethod
    def _is_tile_tracker(state: dict[str, Any]) -> bool:
        entity_id = str(state.get("entity_id") or "").lower()
        attrs = state.get("attributes") or {}
        friendly_name = str(attrs.get("friendly_name") or "").lower()
        model = str(attrs.get("model") or "").lower()
        attribution = str(attrs.get("attribution") or "").lower()
        tile_marker_fields = {
            "is_lost",
            "ring_state",
            "voip_state",
            "last_lost_timestamp",
        }

        if not entity_id.startswith("device_tracker."):
            return False

        if "tile" in entity_id or "tile" in friendly_name or "tile" in model or "tile" in attribution:
            return True

        # Tile entities can be renamed in HA and no longer contain "tile" text.
        return any(field in attrs for field in tile_marker_fields)

    @staticmethod
    def _best_label(entity_id: str, attrs: dict[str, Any]) -> str:
        friendly_name = str(attrs.get("friendly_name") or "").strip()
        if "#" in friendly_name:
            return friendly_name

        explicit_name = str(attrs.get("name") or "").strip()
        if "#" in explicit_name:
            return explicit_name

        model = str(attrs.get("model") or "").strip()
        if model:
            return model

        explicit_name = str(attrs.get("name") or "").strip()
        if explicit_name:
            return explicit_name

        friendly_name = str(attrs.get("friendly_name") or "").strip()
        if friendly_name and friendly_name.lower() not in {"tile", "tile tracker"}:
            return friendly_name

        suffix = entity_id.removeprefix("device_tracker.").replace("_", " ").strip()
        if suffix and suffix.lower() != "tile":
            return suffix.title()

        return friendly_name or entity_id

    @staticmethod
    def _contains_hash(state: dict[str, Any]) -> bool:
        entity_id = str(state.get("entity_id") or "")
        attrs = state.get("attributes") or {}
        friendly_name = str(attrs.get("friendly_name") or "")
        explicit_name = str(attrs.get("name") or "")
        model = str(attrs.get("model") or "")
        return any("#" in value for value in (entity_id, friendly_name, explicit_name, model))

    @staticmethod
    def _to_summary(state: dict[str, Any]) -> TileSummary | None:
        entity_id = str(state.get("entity_id") or "")
        if not entity_id:
            return None
        attrs = state.get("attributes") or {}
        name = HomeAssistantTileClient._best_label(entity_id, attrs)
        return TileSummary(uuid=entity_id, name=name)

    @staticmethod
    def _to_location(state: dict[str, Any], label: str) -> TileLocation | None:
        attrs = state.get("attributes") or {}
        latitude = attrs.get("latitude")
        longitude = attrs.get("longitude")
        if latitude is None or longitude is None:
            return None

        updated = state.get("last_updated") or state.get("last_changed")
        observed_at = (
            datetime.fromisoformat(str(updated).replace("Z", "+00:00"))
            if updated
            else datetime.now(UTC)
        )

        return TileLocation(
            tile_uuid=str(state.get("entity_id")),
            latitude=float(latitude),
            longitude=float(longitude),
            observed_at=observed_at,
            label=label,
        )

    async def list_tiles(self) -> list[TileSummary]:
        states: list[dict[str, Any]] = []

        if self.entity_filter:
            for entity_id in self.entity_filter:
                state = await self._fetch_state(entity_id)
                if state:
                    states.append(state)
        else:
            states = await self._fetch_states()
            states = [item for item in states if self._is_tile_tracker(item)]

        states = [
            item
            for item in states
            if str(item.get("entity_id") or "") not in self.entity_exclude
        ]

        if self.require_hash:
            states = [item for item in states if self._contains_hash(item)]

        self._state_cache = {
            str(item.get("entity_id")): item
            for item in states
            if item.get("entity_id")
        }

        summaries: list[TileSummary] = []
        for item in states:
            summary = self._to_summary(item)
            if summary:
                summaries.append(summary)
        return summaries

    async def get_tile_location(self, tile_uuid: str, label: str) -> TileLocation | None:
        state = self._state_cache.get(tile_uuid)
        if not state:
            state = await self._fetch_state(tile_uuid)
            if not state:
                return None

        return self._to_location(state, label)
