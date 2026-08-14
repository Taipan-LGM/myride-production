from __future__ import annotations

import asyncio
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from app.config import Settings, get_settings
from app.geofire import encode_location
from app.models import DriverProfile, GeoPoint, RiderProfile, Trip, TripStatus

logger = logging.getLogger(__name__)
SOUTH_AFRICA_TZ = timezone(timedelta(hours=2))

# In-memory fallback when Firestore is not configured (local dev)
_memory: dict[str, dict[str, Any]] = {
    "riders": {},
    "drivers": {},
    "trips": {},
    "settings": {},
    "payment_ledger": {},
}
_memory_trip_lock = asyncio.Lock()
_memory_payment_lock = asyncio.Lock()
_memory_settings_lock = asyncio.Lock()
_memory_driver_lock = asyncio.Lock()


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
            "name": data.get("name") or "Driver",
            "phone": data.get("phone"),
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
        if doc and not doc.get("stripe_account_id"):
            from app.postgres_db import get_platform_setting

            stored = await get_platform_setting(f"driver_payout:{driver_id}")
            if stored and stored.get("stripe_account_id"):
                doc = {**doc, "stripe_account_id": stored["stripe_account_id"]}
        return DriverProfile(**doc) if doc else None

    async def attach_driver_stripe_account(self, driver_id: str, account_id: str) -> DriverProfile | None:
        from app.postgres_db import is_postgres_primary, set_platform_setting

        setting = {"stripe_account_id": account_id, "updated_at": _now().isoformat()}
        if is_postgres_primary():
            await set_platform_setting(f"driver_payout:{driver_id}", setting)
        if self._use_memory:
            async with _memory_driver_lock:
                current = _memory["drivers"].get(driver_id)
                if not current:
                    return None
                current.setdefault("stripe_account_id", account_id)
                updated = dict(current)
            if not is_postgres_primary():
                try:
                    await set_platform_setting(f"driver_payout:{driver_id}", setting)
                except Exception as exc:
                    logger.warning("Driver payout account Postgres mirror pending: %s", exc)
            return DriverProfile(**updated)

        from google.cloud import firestore

        document = self._drivers().document(driver_id)
        transaction = self._client.transaction()

        @firestore.async_transactional
        async def attach(transaction):
            snapshot = await document.get(transaction=transaction)
            if not snapshot.exists:
                return None
            current = snapshot.to_dict() or {}
            current.setdefault("stripe_account_id", account_id)
            transaction.set(document, current)
            return {**current, "id": current.get("id", snapshot.id)}

        updated = await attach(transaction)
        try:
            await set_platform_setting(f"driver_payout:{driver_id}", setting)
        except Exception as exc:
            logger.warning("Driver payout account Postgres mirror pending: %s", exc)
        return DriverProfile(**updated) if updated else None

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
        remuneration = await self.get_remuneration_policy()
        payload = {
            **data,
            "id": trip_id,
            "status": data.get("status", TripStatus.requested.value),
            "driver_share_bps": data.get("driver_share_bps", remuneration["driver_share_bps"]),
            "remuneration_policy_version": data.get("remuneration_policy_version", remuneration["version"]),
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
        if "driver_share_bps" in updates:
            existing = await self.get_trip(trip_id)
            requested_share = updates["driver_share_bps"]
            if existing and existing.driver_share_bps is not None and requested_share != existing.driver_share_bps:
                raise ValueError("Trip driver share policy is immutable")
        updates = {**updates, "updated_at": _now().isoformat()}
        from app.postgres_db import is_postgres_primary, mirror_trip, patch_trip

        if is_postgres_primary():
            patched = await patch_trip(trip_id, updates)
            if patched:
                _memory["trips"][trip_id] = patched
            return Trip(**patched) if patched else None

        trip = await self.get_trip(trip_id)
        if not trip:
            return None
        merged = {**trip.model_dump(), **updates}

        if self._use_memory:
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

    async def claim_trip(self, trip_id: str, driver_id: str) -> Trip | None:
        """Atomically assign a requested, unassigned trip to one driver."""
        from app.postgres_db import claim_trip as pg_claim_trip, is_postgres_primary, mirror_trip

        if is_postgres_primary():
            claimed = await pg_claim_trip(trip_id, driver_id)
            if claimed:
                _memory["trips"][trip_id] = claimed
            return Trip(**claimed) if claimed else None

        updates = {
            "driver_id": driver_id,
            "status": TripStatus.driver_assigned.value,
            "updated_at": _now().isoformat(),
        }
        if self._use_memory:
            async with _memory_trip_lock:
                current = _memory["trips"].get(trip_id)
                if not current or current.get("driver_id") or current.get("status") != TripStatus.requested.value:
                    return None
                current.update(updates)
                claimed = dict(current)
            try:
                await mirror_trip(claimed)
            except Exception:
                pass
            return Trip(**claimed)

        from google.cloud import firestore

        document = self._trips().document(trip_id)
        transaction = self._client.transaction()

        @firestore.async_transactional
        async def claim(transaction):
            snapshot = await document.get(transaction=transaction)
            if not snapshot.exists:
                return None
            current = snapshot.to_dict() or {}
            if current.get("driver_id") or current.get("status") != TripStatus.requested.value:
                return None
            transaction.update(document, updates)
            return {**current, **updates, "id": current.get("id", snapshot.id)}

        claimed = await claim(transaction)
        if claimed:
            try:
                await mirror_trip(claimed)
            except Exception:
                pass
        return Trip(**claimed) if claimed else None

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

    async def list_reconciliation_trips(self, limit: int = 50) -> list[Trip]:
        from app.postgres_db import is_postgres_primary, list_reconciliation_trips as pg_list

        if is_postgres_primary():
            return [Trip(**item) for item in await pg_list(limit)]
        if self._use_memory:
            records = list(_memory["trips"].values())
        else:
            docs = [doc async for doc in self._trips().where("status", "==", TripStatus.completed.value).stream()]
            records = [{**doc.to_dict(), "id": doc.id} for doc in docs]
        records = [
            item
            for item in records
            if item.get("status") == TripStatus.completed.value
            and item.get("payment_status") == "captured"
            and item.get("reconciliation_status") != "reconciled"
        ]
        records.sort(
            key=lambda item: str(item.get("reconciliation_attempted_at") or item.get("updated_at") or ""),
            reverse=True,
        )
        return [Trip(**item) for item in records[:limit]]

    async def create_trip_review(
        self,
        trip_id: str,
        reviewer_id: str,
        reviewer_role: str,
        rating: int,
        comment: str | None = None,
    ) -> dict[str, Any]:
        """Persist a driver rating to the Firestore 'reviews' subcollection."""
        if self._use_memory:
            key = f"reviews:{trip_id}:{uuid.uuid4().hex[:8]}"
            record = {
                "trip_id": trip_id,
                "reviewer_id": reviewer_id,
                "reviewer_role": reviewer_role,
                "rating": rating,
                "comment": comment,
                "created_at": _now().isoformat(),
            }
            _memory.setdefault("reviews", {})[key] = record
            return record
        doc = self._trips().document(trip_id).collection("reviews").document(
            reviewer_id[:8] + uuid.uuid4().hex[:8]
        )
        payload = {
            "trip_id": trip_id,
            "reviewer_id": reviewer_id,
            "reviewer_role": reviewer_role,
            "rating": rating,
            "comment": comment,
            "created_at": _now().isoformat(),
        }
        await doc.set(payload)
        return payload

    async def claim_reconciliation_attempt(self, trip_id: str) -> Trip | None:
        from app.postgres_db import claim_reconciliation_attempt as pg_claim, is_postgres_primary

        attempted_at = _now().isoformat()
        stale_before = (_now() - timedelta(minutes=5)).isoformat()
        if is_postgres_primary():
            claimed = await pg_claim(trip_id, attempted_at, stale_before)
            if claimed:
                _memory["trips"][trip_id] = claimed
            return Trip(**claimed) if claimed else None

        def eligible(current: dict[str, Any] | None) -> bool:
            if not current or current.get("reconciliation_status") == "reconciled":
                return False
            if current.get("status") != TripStatus.completed.value or current.get("payment_status") != "captured":
                return False
            return current.get("reconciliation_status") != "pending" or not current.get(
                "reconciliation_attempted_at"
            ) or str(current["reconciliation_attempted_at"]) < stale_before

        if self._use_memory:
            async with _memory_trip_lock:
                current = _memory["trips"].get(trip_id)
                if not eligible(current):
                    return None
                current.update(
                    {
                        "reconciliation_status": "pending",
                        "reconciliation_attempt_count": int(current.get("reconciliation_attempt_count") or 0) + 1,
                        "reconciliation_attempted_at": attempted_at,
                        "reconciliation_error": None,
                        "updated_at": attempted_at,
                    }
                )
                claimed = dict(current)
            return Trip(**claimed)

        from google.cloud import firestore

        document = self._trips().document(trip_id)
        transaction = self._client.transaction()

        @firestore.async_transactional
        async def claim(transaction):
            snapshot = await document.get(transaction=transaction)
            current = snapshot.to_dict() if snapshot.exists else None
            if not eligible(current):
                return None
            updates = {
                "reconciliation_status": "pending",
                "reconciliation_attempt_count": int(current.get("reconciliation_attempt_count") or 0) + 1,
                "reconciliation_attempted_at": attempted_at,
                "reconciliation_error": None,
                "updated_at": attempted_at,
            }
            transaction.update(document, updates)
            return {**current, **updates, "id": current.get("id", snapshot.id)}

        claimed = await claim(transaction)
        return Trip(**claimed) if claimed else None

    async def claim_refund_attempt(self, trip_id: str) -> Trip | None:
        from app.postgres_db import claim_refund_attempt as pg_claim, is_postgres_primary

        attempted_at = _now().isoformat()
        stale_before = (_now() - timedelta(minutes=5)).isoformat()
        if is_postgres_primary():
            claimed = await pg_claim(trip_id, attempted_at, stale_before)
            if claimed:
                _memory["trips"][trip_id] = claimed
            return Trip(**claimed) if claimed else None

        def eligible(current: dict[str, Any] | None) -> bool:
            if not current or current.get("payment_status") not in ("captured", "refunded"):
                return False
            if current.get("refund_status") == "refunded":
                return False
            return current.get("refund_status") != "pending" or not current.get("refund_attempted_at") or str(
                current["refund_attempted_at"]
            ) < stale_before

        updates = None
        if self._use_memory:
            async with _memory_trip_lock:
                current = _memory["trips"].get(trip_id)
                if not eligible(current):
                    return None
                updates = {
                    "refund_status": "pending",
                    "refund_attempt_count": int(current.get("refund_attempt_count") or 0) + 1,
                    "refund_attempted_at": attempted_at,
                    "refund_error": None,
                    "updated_at": attempted_at,
                }
                current.update(updates)
                claimed = dict(current)
            return Trip(**claimed)

        from google.cloud import firestore

        document = self._trips().document(trip_id)
        transaction = self._client.transaction()

        @firestore.async_transactional
        async def claim(transaction):
            snapshot = await document.get(transaction=transaction)
            current = snapshot.to_dict() if snapshot.exists else None
            if not eligible(current):
                return None
            updates = {
                "refund_status": "pending",
                "refund_attempt_count": int(current.get("refund_attempt_count") or 0) + 1,
                "refund_attempted_at": attempted_at,
                "refund_error": None,
                "updated_at": attempted_at,
            }
            transaction.update(document, updates)
            return {**current, **updates, "id": current.get("id", snapshot.id)}

        claimed = await claim(transaction)
        return Trip(**claimed) if claimed else None

    async def driver_earnings_summary(self, driver_id: str) -> dict[str, Any]:
        from app.postgres_db import driver_earnings_rows, is_postgres_primary

        if is_postgres_primary():
            rows = await driver_earnings_rows(driver_id)
        elif self._use_memory:
            rows = [
                dict(item)
                for item in _memory["trips"].values()
                if item.get("driver_id") == driver_id
                and item.get("status") == TripStatus.completed.value
                and item.get("reconciliation_status") == "reconciled"
            ]
        else:
            query = self._trips().where("driver_id", "==", driver_id)
            docs = [doc async for doc in query.stream()]
            rows = [doc.to_dict() for doc in docs]
            rows = [
                item
                for item in rows
                if item.get("status") == TripStatus.completed.value
                and item.get("reconciliation_status") == "reconciled"
            ]

        local_today = datetime.now(SOUTH_AFRICA_TZ).date()
        total_cents = 0
        today_cents = 0
        gross_cents = 0
        platform_fee_cents = 0
        policy_counts: dict[int, int] = {}
        recent: list[dict[str, Any]] = []
        rows.sort(key=lambda item: str(item.get("reconciled_at") or item.get("updated_at") or ""), reverse=True)
        for item in rows:
            payout = int(item.get("driver_payout_cents") or 0)
            fare = int(item.get("fare_final_cents") or item.get("fare_estimate_cents") or 0)
            fee = int(item.get("platform_fee_cents") or 0)
            share = int(item.get("driver_share_bps", self.settings.default_driver_share_bps))
            total_cents += payout
            gross_cents += fare
            platform_fee_cents += fee
            policy_counts[share] = policy_counts.get(share, 0) + 1
            timestamp = item.get("reconciled_at") or item.get("updated_at")
            if timestamp:
                try:
                    reconciled_at = datetime.fromisoformat(str(timestamp).replace("Z", "+00:00"))
                    if reconciled_at.astimezone(SOUTH_AFRICA_TZ).date() == local_today:
                        today_cents += payout
                except ValueError:
                    pass
            if len(recent) < 10:
                recent.append(
                    {
                        "trip_id": str(item.get("id", "")),
                        "amount_cents": payout,
                        "fare_cents": fare,
                        "platform_fee_cents": fee,
                        "driver_share_bps": share,
                        "currency": item.get("currency", "zar"),
                        "reconciled_at": timestamp,
                    }
                )

        shares = sorted(policy_counts)
        current_share = shares[0] if len(shares) == 1 else None
        return {
            "driver_id": driver_id,
            "currency": "zar",
            "trips": len(rows),
            "total_cents": total_cents,
            "total_zar": round(total_cents / 100, 2),
            "today_cents": today_cents,
            "today_zar": round(today_cents / 100, 2),
            "gross_fare_cents": gross_cents,
            "gross_fare_zar": round(gross_cents / 100, 2),
            "platform_fee_cents": platform_fee_cents,
            "platform_fee_zar": round(platform_fee_cents / 100, 2),
            "driver_share_bps": current_share,
            "driver_share_percent": current_share / 100 if current_share is not None else None,
            "policy_breakdown": [
                {"driver_share_bps": share, "driver_share_percent": share / 100, "trips": policy_counts[share]}
                for share in shares
            ],
            "recent": recent,
        }

    async def get_remuneration_policy(self) -> dict[str, Any]:
        from app.postgres_db import get_platform_setting, is_postgres_primary

        if is_postgres_primary():
            stored = await get_platform_setting("remuneration")
        elif self._use_memory:
            stored = _memory["settings"].get("remuneration")
        else:
            snapshot = await self._client.collection("platform_settings").document("remuneration").get()
            stored = snapshot.to_dict() if snapshot.exists else None
        if stored:
            return dict(stored)
        return {
            "version": 1,
            "driver_share_bps": self.settings.default_driver_share_bps,
            "effective_at": None,
            "updated_at": None,
            "updated_by": "environment-default",
        }

    async def update_remuneration_policy(self, driver_share_bps: int, updated_by: str) -> dict[str, Any]:
        from app.postgres_db import is_postgres_primary, set_platform_setting, update_remuneration_setting

        now = _now().isoformat()
        fields = {
            "driver_share_bps": int(driver_share_bps),
            "effective_at": now,
            "updated_at": now,
            "updated_by": updated_by,
        }
        if is_postgres_primary():
            return await update_remuneration_setting(fields)
        elif self._use_memory:
            async with _memory_settings_lock:
                current = _memory["settings"].get("remuneration") or {"version": 1}
                policy = {"version": int(current.get("version", 1)) + 1, **fields}
                _memory["settings"]["remuneration"] = policy
            try:
                await set_platform_setting("remuneration", policy)
            except Exception as exc:
                logger.warning("Remuneration policy Postgres mirror pending: %s", exc)
        else:
            from google.cloud import firestore

            document = self._client.collection("platform_settings").document("remuneration")
            transaction = self._client.transaction()

            @firestore.async_transactional
            async def update_policy(transaction):
                snapshot = await document.get(transaction=transaction)
                current = snapshot.to_dict() if snapshot.exists else {"version": 1}
                policy = {"version": int(current.get("version", 1)) + 1, **fields}
                transaction.set(document, policy)
                return policy

            policy = await update_policy(transaction)
            try:
                await set_platform_setting("remuneration", policy)
            except Exception as exc:
                logger.warning("Remuneration policy Postgres mirror pending: %s", exc)
        return policy

    async def get_payment_record(self, idempotency_key: str) -> dict[str, Any] | None:
        from app.postgres_db import get_payment_record as pg_get_payment, is_postgres_primary

        if is_postgres_primary():
            return await pg_get_payment(idempotency_key)
        if self._use_memory:
            record = _memory["payment_ledger"].get(idempotency_key)
            return dict(record) if record else None
        snapshot = await self._client.collection("payment_ledger").document(idempotency_key).get()
        return snapshot.to_dict() if snapshot.exists else None

    async def create_or_get_payment_record(
        self,
        idempotency_key: str,
        record: dict[str, Any],
        kind: str = "reconciliation",
    ) -> dict[str, Any]:
        from app.postgres_db import create_or_get_payment_record as pg_create_payment, is_postgres_primary

        if is_postgres_primary():
            return await pg_create_payment(idempotency_key, record, kind)
        if self._use_memory:
            async with _memory_payment_lock:
                canonical = _memory["payment_ledger"].setdefault(idempotency_key, dict(record))
            try:
                await pg_create_payment(idempotency_key, canonical, kind)
            except Exception as exc:
                logger.warning("Payment ledger Postgres mirror pending: %s", exc)
            return dict(canonical)
        document = self._client.collection("payment_ledger").document(idempotency_key)
        snapshot = await document.get()
        if snapshot.exists:
            canonical = snapshot.to_dict()
        else:
            try:
                await document.create(record)
                canonical = dict(record)
            except Exception:
                snapshot = await document.get()
                if not snapshot.exists:
                    raise
                canonical = snapshot.to_dict()
        try:
            await pg_create_payment(idempotency_key, canonical, kind)
        except Exception as exc:
            logger.warning("Payment ledger Postgres mirror pending: %s", exc)
        return canonical

    async def list_payment_records(self, limit: int = 50) -> list[dict[str, Any]]:
        from app.postgres_db import is_postgres_primary, list_payment_records as pg_list_payments

        if is_postgres_primary():
            return await pg_list_payments(limit)
        if self._use_memory:
            records = list(_memory["payment_ledger"].values())
        else:
            docs = [doc async for doc in self._client.collection("payment_ledger").stream()]
            records = [doc.to_dict() for doc in docs]
        records.sort(key=lambda item: str(item.get("reconciled_at", "")), reverse=True)
        return [dict(item) for item in records[:limit]]

    async def list_payment_records_since(self, since: datetime) -> list[dict[str, Any]]:
        from app.postgres_db import is_postgres_primary, list_payment_records_since as pg_list_since

        if is_postgres_primary():
            return await pg_list_since(since)
        since_iso = since.astimezone(timezone.utc).isoformat()
        if self._use_memory:
            records = [
                dict(record)
                for record in _memory["payment_ledger"].values()
                if str(record.get("reconciled_at") or record.get("refunded_at") or "") >= since_iso
            ]
        else:
            records = [doc.to_dict() async for doc in self._client.collection("payment_ledger").stream()]
            records = [
                record
                for record in records
                if str(record.get("reconciled_at") or record.get("refunded_at") or "") >= since_iso
            ]
        records.sort(key=lambda item: str(item.get("reconciled_at") or item.get("refunded_at") or ""), reverse=True)
        return records

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
