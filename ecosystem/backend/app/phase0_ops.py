"""Phase 0 ops — bulk demo drivers + simulated completed rides (admin-only)."""

from __future__ import annotations

import math
import random
from typing import Any

from app.firestore_db import FirestoreDB
from app.models import GeoPoint, TripStatus

# Cape Town CBD-ish scatter
_BASE_LAT = -33.9249
_BASE_LNG = 18.4241


def _offset(i: int, scale: float = 0.04) -> GeoPoint:
    # Deterministic ring so re-runs are stable
    ang = (i * 0.37) % (2 * math.pi)
    r = scale * (0.2 + (i % 10) / 10)
    return GeoPoint(
        lat=_BASE_LAT + r * math.cos(ang),
        lng=_BASE_LNG + r * math.sin(ang),
    )


async def seed_drivers(db: FirestoreDB, count: int = 100) -> dict[str, Any]:
    """Create driver-phase0-001 … N (idempotent upserts)."""
    count = max(1, min(int(count), 500))
    created: list[str] = []
    for i in range(1, count + 1):
        did = f"driver-phase0-{i:03d}"
        loc = _offset(i)
        existing = await db.get_driver(did)
        if existing:
            await db.update_driver_location(did, loc, is_online=True)
        else:
            await db.create_driver(
                {
                    "id": did,
                    "name": f"Phase0 Driver {i}",
                    "phone": f"+2782{i:07d}",
                    "vehicle_make": "standard" if i % 5 else "premium",
                    "vehicle_model": "Sedan",
                    "vehicle_plate": f"CA {1000 + i} GP",
                    "location": loc.model_dump(),
                    "is_online": True,
                    "rating": round(4.5 + (i % 5) * 0.1, 2),
                }
            )
        created.append(did)
    return {"drivers": len(created), "ids_sample": created[:5], "ids_last": created[-1]}


async def simulate_completed_rides(
    db: FirestoreDB,
    *,
    count: int = 1000,
    rider_id: str = "rider-demo-001",
) -> dict[str, Any]:
    """Create and complete N trips for volume soak / Phase 0 metrics."""
    count = max(1, min(int(count), 5000))
    drivers = await db.list_online_drivers()
    if not drivers:
        await seed_drivers(db, 100)
        drivers = await db.list_online_drivers()
    trip_ids: list[str] = []
    for i in range(count):
        pickup = _offset(i, scale=0.03)
        dropoff = _offset(i + 17, scale=0.05)
        driver = drivers[i % len(drivers)]
        fare = 3500 + (i % 40) * 100
        trip = await db.create_trip(
            {
                "rider_id": rider_id,
                "driver_id": driver.id,
                "pickup": pickup.model_dump(),
                "dropoff": dropoff.model_dump(),
                "pickup_address": f"Pickup {i}",
                "dropoff_address": f"Dropoff {i}",
                "fare_estimate_cents": fare,
                "fare_final_cents": fare,
                "currency": "zar",
                "status": TripStatus.completed.value,
                "payment_status": "captured",
                "booking_channel": "phase0",
            }
        )
        # Ensure completed if create ignored status
        if trip.status != TripStatus.completed:
            trip = await db.update_trip(
                trip.id,
                {
                    "status": TripStatus.completed.value,
                    "driver_id": driver.id,
                    "fare_final_cents": fare,
                    "payment_status": "captured",
                },
            )
        trip_ids.append(trip.id)
    return {
        "rides_completed": len(trip_ids),
        "drivers_used": len(drivers),
        "sample_trip_ids": trip_ids[:3],
        "last_trip_id": trip_ids[-1] if trip_ids else None,
    }


async def phase0_bootstrap(
    db: FirestoreDB,
    *,
    drivers: int = 100,
    rides: int = 1000,
) -> dict[str, Any]:
    d = await seed_drivers(db, drivers)
    r = await simulate_completed_rides(db, count=rides)
    return {"drivers": d, "rides": r, "note": "In-memory store resets on redeploy; Postgres dual-write mirrors trips when DATABASE_URL set."}
