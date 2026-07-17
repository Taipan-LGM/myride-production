from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any

from app.config import Settings, get_settings
from app.geofire import encode_location
from app.models import DriverProfile, GeoPoint, RiderProfile, Trip, TripStatus

logger = logging.getLogger(__name__)

# In-memory fallback when Firestore is not configured (local dev)
_memory: dict[str, dict[str, Any]] = {
    "riders": {},
    "drivers": {},
    "trips": {},
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


class FirestoreDB:
    """Async CRUD for riders, drivers, and trips. Uses Firestore when configured."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self._client = None
        self._use_memory = not self.settings.firestore_project_id

    async def connect(self) -> None:
        if self._use_memory:
            logger.info("Firestore: using in-memory store (set FIRESTORE_PROJECT_ID for production)")
            return

        if self.settings.use_firestore_emulator:
            os.environ.setdefault("FIRESTORE_EMULATOR_HOST", self.settings.firestore_emulator_host)

        if self.settings.google_application_credentials:
            os.environ.setdefault(
                "GOOGLE_APPLICATION_CREDENTIALS",
                self.settings.google_application_credentials,
            )

        from google.cloud import firestore

        self._client = firestore.AsyncClient(project=self.settings.firestore_project_id)
        logger.info("Firestore connected: project=%s", self.settings.firestore_project_id)

    async def close(self) -> None:
        if self._client is not None:
            await self._client.close()
            self._client = None

    def _riders(self):
        assert self._client is not None
        return self._client.collection("riders")

    def _drivers(self):
        assert self._client is not None
        return self._client.collection("drivers")

    def _trips(self):
        assert self._client is not None
        return self._client.collection("trips")

    # --- Riders ---

    async def create_rider(self, data: dict[str, Any]) -> RiderProfile:
        rider_id = data.get("id") or str(uuid.uuid4())
        payload = {**data, "id": rider_id, "created_at": _now().isoformat()}
        if self._use_memory:
            _memory["riders"][rider_id] = payload
        else:
            await self._riders().document(rider_id).set(payload)
        return RiderProfile(**payload)

    async def get_rider(self, rider_id: str) -> RiderProfile | None:
        doc = await self._get_doc("riders", rider_id)
        return RiderProfile(**doc) if doc else None

    # --- Drivers ---

    async def create_driver(self, data: dict[str, Any]) -> DriverProfile:
        driver_id = data.get("id") or str(uuid.uuid4())
        location = data.get("location")
        geohash = data.get("geohash")
        if location and not geohash:
            point = location if isinstance(location, GeoPoint) else GeoPoint(**location)
            geohash = encode_location(point)
            if isinstance(location, GeoPoint):
                location = location.model_dump()
        payload = {
            **data,
            "id": driver_id,
            "location": location,
            "geohash": geohash,
            "created_at": _now().isoformat(),
        }
        if self._use_memory:
            _memory["drivers"][driver_id] = payload
        else:
            await self._drivers().document(driver_id).set(payload)
        return DriverProfile(**payload)

    async def get_driver(self, driver_id: str) -> DriverProfile | None:
        doc = await self._get_doc("drivers", driver_id)
        return DriverProfile(**doc) if doc else None

    async def update_driver_location(
        self,
        driver_id: str,
        location: GeoPoint,
        is_online: bool = True,
    ) -> DriverProfile | None:
        driver = await self.get_driver(driver_id)
        if not driver:
            return None
        payload = {
            "location": location.model_dump(),
            "geohash": encode_location(location),
            "is_online": is_online,
        }
        if self._use_memory:
            _memory["drivers"][driver_id].update(payload)
        else:
            await self._drivers().document(driver_id).update(payload)
        updated = {**driver.model_dump(), **payload}
        return DriverProfile(**updated)

    async def list_online_drivers(self) -> list[DriverProfile]:
        if self._use_memory:
            return [
                DriverProfile(**d)
                for d in _memory["drivers"].values()
                if d.get("is_online")
            ]
        query = self._drivers().where("is_online", "==", True)
        docs = [doc async for doc in query.stream()]
        return [DriverProfile(id=doc.id, **doc.to_dict()) for doc in docs]

    # --- Trips ---

    async def create_trip(self, data: dict[str, Any]) -> Trip:
        trip_id = data.get("id") or str(uuid.uuid4())
        now = _now().isoformat()
        payload = {
            **data,
            "id": trip_id,
            "status": data.get("status", TripStatus.requested.value),
            "created_at": now,
            "updated_at": now,
        }
        from app.postgres_db import is_postgres_primary, mirror_trip

        if is_postgres_primary():
            await mirror_trip(payload)
            # Hot cache for WS/session within this process
            _memory["trips"][trip_id] = payload
        elif self._use_memory:
            _memory["trips"][trip_id] = payload
            try:
                await mirror_trip(payload)
            except Exception:
                pass
        else:
            await self._trips().document(trip_id).set(payload)
            try:
                await mirror_trip(payload)
            except Exception:
                pass
        return Trip(**payload)

    async def get_trip(self, trip_id: str) -> Trip | None:
        from app.postgres_db import fetch_trip, is_postgres_primary

        if is_postgres_primary():
            doc = await fetch_trip(trip_id)
            if doc:
                _memory["trips"][trip_id] = doc
                return Trip(**doc)
            # Fall through to process cache during PG blip
        doc = await self._get_doc("trips", trip_id)
        return Trip(**doc) if doc else None

    async def update_trip(self, trip_id: str, updates: dict[str, Any]) -> Trip | None:
        trip = await self.get_trip(trip_id)
        if not trip:
            return None
        updates = {**updates, "updated_at": _now().isoformat()}
        merged = {**trip.model_dump(), **updates}
        from app.postgres_db import is_postgres_primary, mirror_trip

        if is_postgres_primary():
            await mirror_trip(merged)
            _memory["trips"][trip_id] = merged
        elif self._use_memory:
            _memory["trips"][trip_id].update(updates)
            try:
                await mirror_trip(merged)
            except Exception:
                pass
        else:
            await self._trips().document(trip_id).update(updates)
            try:
                await mirror_trip(merged)
            except Exception:
                pass
        return Trip(**merged)

    async def list_trips_for_rider(self, rider_id: str, limit: int = 20) -> list[Trip]:
        from app.postgres_db import is_postgres_primary, list_trips as pg_list

        if is_postgres_primary():
            items = await pg_list(rider_id=rider_id, limit=limit)
            return [Trip(**t) for t in items]
        if self._use_memory:
            items = [t for t in _memory["trips"].values() if t.get("rider_id") == rider_id]
            items.sort(key=lambda t: t.get("created_at", ""), reverse=True)
            return [Trip(**t) for t in items[:limit]]
        query = self._trips().where("rider_id", "==", rider_id).limit(limit)
        docs = [doc async for doc in query.stream()]
        return [Trip(id=doc.id, **doc.to_dict()) for doc in docs]

    async def list_trips(
        self,
        rider_id: str | None = None,
        driver_id: str | None = None,
        limit: int = 50,
    ) -> list[Trip]:
        from app.postgres_db import is_postgres_primary, list_trips as pg_list

        if is_postgres_primary():
            items = await pg_list(rider_id=rider_id, driver_id=driver_id, limit=limit)
            return [Trip(**t) for t in items]
        if self._use_memory:
            items = list(_memory["trips"].values())
            if rider_id:
                items = [t for t in items if t.get("rider_id") == rider_id]
            if driver_id:
                items = [t for t in items if t.get("driver_id") == driver_id]
            items.sort(key=lambda t: t.get("created_at", ""), reverse=True)
            return [Trip(**t) for t in items[:limit]]
        query = self._trips()
        if rider_id:
            query = query.where("rider_id", "==", rider_id)
        if driver_id:
            query = query.where("driver_id", "==", driver_id)
        docs = [doc async for doc in query.limit(limit).stream()]
        return [Trip(id=doc.id, **doc.to_dict()) for doc in docs]

    async def _get_doc(self, collection: str, doc_id: str) -> dict[str, Any] | None:
        if self._use_memory:
            return _memory[collection].get(doc_id)
        coll = getattr(self, f"_{collection}")()
        snap = await coll.document(doc_id).get()
        if not snap.exists:
            return None
        data = snap.to_dict() or {}
        data.setdefault("id", snap.id)
        return data


_db: FirestoreDB | None = None


async def get_db() -> FirestoreDB:
    global _db
    if _db is None:
        _db = FirestoreDB()
        await _db.connect()
    return _db
