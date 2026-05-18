from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import httpx

from src.services.models import TileLocation, TileSummary


class TileClient:
    def __init__(self, base_url: str, email: str, password: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.email = email
        self.password = password
        self._token: str | None = None

    async def login(self) -> None:
        payload = {"email": self.email, "password": self.password}
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(f"{self.base_url}/users/login", json=payload)
            response.raise_for_status()
            data = response.json()

        # The endpoint is unofficial; accept several likely token keys defensively.
        self._token = (
            data.get("token")
            or data.get("session_token")
            or data.get("sessionToken")
            or data.get("auth_token")
        )
        if not self._token:
            raise RuntimeError("Tile login succeeded but no session token was returned")

    async def _auth_headers(self) -> dict[str, str]:
        if not self._token:
            await self.login()
        return {"Authorization": f"Bearer {self._token}"}

    async def list_tiles(self) -> list[TileSummary]:
        headers = await self._auth_headers()
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get(f"{self.base_url}/tiles", headers=headers)
            if response.status_code == 401:
                await self.login()
                headers = await self._auth_headers()
                response = await client.get(f"{self.base_url}/tiles", headers=headers)
            response.raise_for_status()
            data = response.json()

        raw_tiles: list[dict[str, Any]]
        if isinstance(data, dict):
            raw_tiles = data.get("tiles", [])
        elif isinstance(data, list):
            raw_tiles = data
        else:
            raw_tiles = []

        tiles: list[TileSummary] = []
        for item in raw_tiles:
            tile_uuid = str(item.get("uuid") or item.get("id") or "")
            if not tile_uuid:
                continue
            tiles.append(
                TileSummary(
                    uuid=tile_uuid,
                    name=str(item.get("name") or item.get("label") or tile_uuid),
                )
            )
        return tiles

    async def get_tile_location(self, tile_uuid: str, label: str) -> TileLocation | None:
        headers = await self._auth_headers()
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get(f"{self.base_url}/tiles/{tile_uuid}/location", headers=headers)
            if response.status_code == 401:
                await self.login()
                headers = await self._auth_headers()
                response = await client.get(
                    f"{self.base_url}/tiles/{tile_uuid}/location",
                    headers=headers,
                )
            if response.status_code == 404:
                return None
            response.raise_for_status()
            data = response.json()

        latitude = data.get("latitude") or data.get("lat")
        longitude = data.get("longitude") or data.get("lng") or data.get("lon")
        if latitude is None or longitude is None:
            return None

        timestamp = data.get("timestamp") or data.get("observed_at")
        observed_at = (
            datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
            if isinstance(timestamp, str)
            else datetime.now(UTC)
        )

        return TileLocation(
            tile_uuid=tile_uuid,
            latitude=float(latitude),
            longitude=float(longitude),
            observed_at=observed_at,
            label=label,
        )
