from __future__ import annotations

from datetime import datetime, timezone
from functools import lru_cache
import math
from typing import Any
from urllib.parse import urlsplit

import httpx

from app.config import Settings, get_settings


class CartrackError(RuntimeError):
    pass


class CartrackNotConfigured(CartrackError):
    pass


class CartrackUpstreamError(CartrackError):
    pass


class CartrackService:
    def __init__(self, settings: Settings | None = None, client: httpx.AsyncClient | None = None) -> None:
        self.settings = settings or get_settings()
        self.client = client
        self._owns_client = client is None

    @property
    def enabled(self) -> bool:
        return bool(
            self.settings.cartrack_enabled
            and self.settings.cartrack_base_url.strip()
            and self.settings.cartrack_username.strip()
            and self.settings.cartrack_api_key.strip()
        )

    @property
    def approved_base_url(self) -> bool:
        parsed = urlsplit(self.settings.cartrack_base_url.strip())
        hostname = (parsed.hostname or "").lower()
        try:
            port = parsed.port
        except ValueError:
            return False
        approved_host = (
            hostname == "fleetapi.cartrack.com"
            or (hostname.startswith("fleetapi-") and hostname.endswith(".cartrack.com"))
        )
        return bool(
            parsed.scheme == "https"
            and approved_host
            and parsed.username is None
            and parsed.password is None
            and port in (None, 443)
            and not parsed.query
            and not parsed.fragment
        )

    async def list_vehicles(self) -> dict[str, Any]:
        if not self.enabled or not self.approved_base_url:
            raise CartrackNotConfigured("Cartrack fleet telemetry is not configured")

        if self.client is None:
            self.client = httpx.AsyncClient(timeout=8.0, follow_redirects=False)
        try:
            response = await self.client.get(
                f"{self.settings.cartrack_base_url.rstrip('/')}/vehicles/status",
                auth=httpx.BasicAuth(self.settings.cartrack_username, self.settings.cartrack_api_key),
            )
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError) as error:
            raise CartrackUpstreamError("Cartrack fleet telemetry is unavailable") from error

        records = payload.get("data", payload) if isinstance(payload, dict) else payload
        if isinstance(records, dict):
            records = records.get("vehicles", records.get("results", []))
        if not isinstance(records, list):
            records = []

        vehicles = [vehicle for item in records if (vehicle := self._normalize_vehicle(item))]
        return {
            "provider": "cartrack",
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "vehicles": vehicles,
        }

    @staticmethod
    def _normalize_vehicle(item: Any) -> dict[str, Any] | None:
        if not isinstance(item, dict):
            return None
        position = item.get("position") or item.get("location") or item
        latitude = position.get("latitude", position.get("lat"))
        longitude = position.get("longitude", position.get("lng", position.get("lon")))
        try:
            latitude = float(latitude)
            longitude = float(longitude)
        except (TypeError, ValueError):
            return None
        if not (math.isfinite(latitude) and math.isfinite(longitude)):
            return None
        if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
            return None

        vehicle_id = item.get("id") or item.get("vehicle_id") or item.get("registration") or item.get("registration_number")
        if vehicle_id is None:
            return None
        registration = item.get("registration") or item.get("registration_number") or item.get("license_plate") or str(vehicle_id)
        label = item.get("name") or item.get("label") or item.get("description") or registration
        return {
            "id": str(vehicle_id),
            "registration": str(registration),
            "label": str(label),
            "lat": latitude,
            "lng": longitude,
            "heading": CartrackService._number(position.get("heading", position.get("direction"))),
            "speed_kph": CartrackService._number(position.get("speed", position.get("speed_kph"))),
            "ignition": CartrackService._boolean(item.get("ignition", item.get("ignition_on", False))),
            "updated_at": position.get("updated_at") or position.get("timestamp") or item.get("updated_at"),
        }

    @staticmethod
    def _number(value: Any) -> float:
        try:
            number = float(value or 0)
        except (TypeError, ValueError):
            return 0.0
        return number if math.isfinite(number) else 0.0

    @staticmethod
    def _boolean(value: Any) -> bool:
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "on"}
        return value is True or value == 1

    async def close(self) -> None:
        if self.client is not None and self._owns_client:
            await self.client.aclose()
            self.client = None


@lru_cache
def get_cartrack() -> CartrackService:
    return CartrackService()


async def close_cartrack() -> None:
    if get_cartrack.cache_info().currsize:
        await get_cartrack().close()