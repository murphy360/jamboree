from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from src.services.models import TileLocation, TileSummary


class HomeAssistantTileClient:
    _TILE_TIMESTAMP_KEYS = (
        "last_seen",
        "last_update",
        "last_updated",
        "timestamp",
        "last_timestamp",
        "location_updated_at",
        "tile_updated_at",
        "last_location_update",
    )

    def __init__(
        self,
        base_url: str,
        token: str,
        tile_entities: str = "",
        exclude_entities: str = "",
        require_hash: bool = True,
        timestamp_offset_minutes: int = 0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.entity_filter = [item.strip() for item in tile_entities.split(",") if item.strip()]
        self.entity_exclude = {item.strip() for item in exclude_entities.split(",") if item.strip()}
        self.require_hash = require_hash
        self.timestamp_offset_minutes = timestamp_offset_minutes
        self._state_cache: dict[str, dict[str, Any]] = {}

    def _apply_timestamp_offset(self, timestamp: datetime | None) -> datetime | None:
        if not timestamp:
            return None
        if not self.timestamp_offset_minutes:
            return timestamp
        return timestamp + timedelta(minutes=self.timestamp_offset_minutes)

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
    def _parse_datetime(value: Any) -> datetime | None:
        if isinstance(value, datetime):
            if value.tzinfo is None:
                return value.replace(tzinfo=UTC)
            return value

        if isinstance(value, (int, float)):
            ts = float(value)
            if ts > 10_000_000_000:
                ts = ts / 1000
            try:
                return datetime.fromtimestamp(ts, tz=UTC)
            except (OverflowError, OSError, ValueError):
                return None

        if isinstance(value, str):
            raw = value.strip()
            if not raw:
                return None

            if raw.replace(".", "", 1).isdigit():
                return HomeAssistantTileClient._parse_datetime(float(raw))

            try:
                parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            except ValueError:
                return None

            if parsed.tzinfo is None:
                return parsed.replace(tzinfo=UTC)
            return parsed

        return None

    @staticmethod
    def _is_tile_timestamp_key(key: str) -> bool:
        key_normalized = key.strip().lower()
        if not key_normalized:
            return False

        excluded_tokens = ("lost", "ring", "voip")
        if any(token in key_normalized for token in excluded_tokens):
            return False

        has_last = "last" in key_normalized
        has_tile_signal = any(
            token in key_normalized
            for token in ("seen", "update", "location", "locate", "timestamp", "position")
        )
        return has_last and has_tile_signal

    def _extract_tile_service_timestamp_with_source(self, attrs: dict[str, Any]) -> tuple[datetime | None, str | None]:
        for key in HomeAssistantTileClient._TILE_TIMESTAMP_KEYS:
            parsed = HomeAssistantTileClient._parse_datetime(attrs.get(key))
            parsed = self._apply_timestamp_offset(parsed)
            if parsed:
                return parsed, key

        for key, value in attrs.items():
            key_str = str(key)
            if not HomeAssistantTileClient._is_tile_timestamp_key(key_str):
                continue
            parsed = HomeAssistantTileClient._parse_datetime(value)
            parsed = self._apply_timestamp_offset(parsed)
            if parsed:
                return parsed, key_str

        return None, None

    def _extract_tile_service_timestamp(self, attrs: dict[str, Any]) -> datetime | None:
        timestamp, _ = self._extract_tile_service_timestamp_with_source(attrs)
        return timestamp

    def _build_timestamp_candidates(self, attrs: dict[str, Any]) -> list[dict[str, str | bool | int]]:
        candidates: list[dict[str, str | bool | int]] = []
        for key, value in attrs.items():
            key_str = str(key)
            if not (
                key_str in HomeAssistantTileClient._TILE_TIMESTAMP_KEYS
                or HomeAssistantTileClient._is_tile_timestamp_key(key_str)
            ):
                continue

            parsed = HomeAssistantTileClient._parse_datetime(value)
            if not parsed:
                continue

            parsed_utc = parsed.astimezone(UTC)
            adjusted_utc = self._apply_timestamp_offset(parsed_utc) or parsed_utc
            candidates.append(
                {
                    "field": key_str,
                    "raw": str(value),
                    "parsed_utc": parsed_utc.isoformat(),
                    "adjusted_utc": adjusted_utc.isoformat(),
                    "offset_minutes": self.timestamp_offset_minutes,
                    "is_tile_timestamp_candidate": HomeAssistantTileClient._is_tile_timestamp_key(key_str),
                }
            )
        return candidates

    def _to_location(self, state: dict[str, Any], label: str) -> TileLocation | None:
        attrs = state.get("attributes") or {}
        latitude = attrs.get("latitude")
        longitude = attrs.get("longitude")
        if latitude is None or longitude is None:
            return None

        updated = state.get("last_updated") or state.get("last_changed")
        state_updated_at = HomeAssistantTileClient._parse_datetime(updated)
        tile_service_observed_at = self._extract_tile_service_timestamp(attrs) or state_updated_at
        observed_at = tile_service_observed_at or state_updated_at or datetime.now(UTC)
        polled_at = datetime.now(UTC)

        return TileLocation(
            tile_uuid=str(state.get("entity_id")),
            latitude=float(latitude),
            longitude=float(longitude),
            observed_at=observed_at,
            label=label,
            tile_service_observed_at=tile_service_observed_at,
            polled_at=polled_at,
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

    async def debug_tile_timestamps(self) -> list[dict[str, Any]]:
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

        details: list[dict[str, Any]] = []

        for state in states:
            entity_id = str(state.get("entity_id") or "")
            attrs = state.get("attributes") or {}
            label = self._best_label(entity_id, attrs)
            tile_ts, tile_ts_field = self._extract_tile_service_timestamp_with_source(attrs)
            state_last_updated = self._parse_datetime(state.get("last_updated"))
            state_last_changed = self._parse_datetime(state.get("last_changed"))

            details.append(
                {
                    "tile_uuid": entity_id,
                    "label": label,
                    "selected_tile_timestamp_field": tile_ts_field,
                    "selected_tile_timestamp_utc": tile_ts.astimezone(UTC).isoformat() if tile_ts else None,
                    "selected_tile_timestamp_is_future": False,
                    "tile_timestamp_offset_minutes": self.timestamp_offset_minutes,
                    "state_last_updated_utc": state_last_updated.astimezone(UTC).isoformat()
                    if state_last_updated
                    else None,
                    "state_last_changed_utc": state_last_changed.astimezone(UTC).isoformat()
                    if state_last_changed
                    else None,
                    "timestamp_candidates": self._build_timestamp_candidates(attrs),
                    "attributes": attrs,
                    "state_raw": state,
                }
            )

        return details

    async def get_tile_location(self, tile_uuid: str, label: str) -> TileLocation | None:
        state = self._state_cache.get(tile_uuid)
        if not state:
            state = await self._fetch_state(tile_uuid)
            if not state:
                return None

        return self._to_location(state, label)
