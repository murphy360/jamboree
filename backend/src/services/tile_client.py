from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import httpx

from src.services.models import TileLocation, TileSummary


class TileClient:
    def __init__(
        self,
        base_url: str,
        email: str,
        password: str,
        app_id: str = "",
        app_version: str = "",
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.email = email
        self.password = password
        self.app_id = app_id
        self.app_version = app_version
        self._token: str | None = None

    def _base_headers(self) -> dict[str, str]:
        headers = {
            "Accept": "application/json",
            "User-Agent": "jamboree-tracker/0.1",
        }
        if self.app_id:
            headers["Tile-App-Id"] = self.app_id
            headers["X-Tile-App-Id"] = self.app_id
        if self.app_version:
            headers["Tile-App-Version"] = self.app_version
            headers["X-Tile-App-Version"] = self.app_version
        return headers

    @staticmethod
    def _extract_token(data: Any) -> str | None:
        if isinstance(data, dict):
            for key in ("token", "session_token", "sessionToken", "auth_token", "access_token"):
                value = data.get(key)
                if isinstance(value, str) and value.strip():
                    return value
            for value in data.values():
                token = TileClient._extract_token(value)
                if token:
                    return token
        if isinstance(data, list):
            for item in data:
                token = TileClient._extract_token(item)
                if token:
                    return token
        return None

    async def login(self) -> None:
        if not self.email or not self.password:
            raise RuntimeError("Tile credentials are missing. Set TILE_EMAIL and TILE_PASSWORD.")

        payload = {"email": self.email, "password": self.password}
        login_url = f"{self.base_url}/users/login"
        params = {
            "email": self.email,
            "password": self.password,
            "app_id": self.app_id,
            "version": self.app_version,
        }
        headers = self._base_headers()

        attempts: list[tuple[str, dict[str, Any]]] = [
            ("post", {"json": payload}),
            ("post", {"data": payload}),
            ("put", {"json": payload}),
            ("put", {"data": payload}),
            ("get", {"params": params}),
            ("put", {"params": params}),
        ]

        last_error: str | None = None
        async with httpx.AsyncClient(timeout=20) as client:
            for method, kwargs in attempts:
                request_kwargs = {"headers": headers, **kwargs}
                response = await client.request(method.upper(), login_url, **request_kwargs)
                if response.status_code >= 400:
                    last_error = f"{method.upper()} {response.status_code}: {response.text[:240]}"
                    continue
                try:
                    data = response.json()
                except ValueError:
                    last_error = f"{method.upper()} returned non-JSON response"
                    continue

                self._token = self._extract_token(data)
                if self._token:
                    return
                last_error = f"{method.upper()} login returned no token key"

        if not self._token:
            message = (
                "Tile login failed across fallback methods. "
                "Set TILE_APP_ID and TILE_APP_VERSION from a valid Tile mobile client capture. "
                f"Last error: {last_error}"
            )
            raise RuntimeError(message)

    async def _auth_headers(self) -> dict[str, str]:
        if not self._token:
            await self.login()
        auth_headers = self._base_headers()
        auth_headers["Authorization"] = f"Bearer {self._token}"
        auth_headers["Tile-Session-Token"] = self._token
        auth_headers["X-Auth-Token"] = self._token
        return auth_headers

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
            raw_tiles = data.get("tiles") or data.get("items") or data.get("results") or []
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
