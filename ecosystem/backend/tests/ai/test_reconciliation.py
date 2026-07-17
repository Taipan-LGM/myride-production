from __future__ import annotations

import pytest

from app.firestore_db import FirestoreDB
from app.models import GeoPoint, TripStatus
from app.reconciliation import PaymentReconciliation


@pytest.mark.asyncio
async def test_reconcile_splits_platform_fee():
    db = FirestoreDB()
    await db.connect()
    trip = await db.create_trip(
        {
            "id": "trip-recon-1",
            "rider_id": "r1",
            "driver_id": "d1",
            "pickup": GeoPoint(lat=-33.92, lng=18.42).model_dump(),
            "dropoff": GeoPoint(lat=-33.91, lng=18.41).model_dump(),
            "fare_estimate_cents": 10000,
            "fare_final_cents": 10000,
            "currency": "zar",
            "status": TripStatus.completed.value,
        }
    )
    recon = PaymentReconciliation()
    record = await recon.reconcile_trip(db, trip.id)
    assert record.amount_cents == 10000
    assert record.platform_fee_cents == 1500
    assert record.driver_payout_cents == 8500
    assert record.status == "reconciled"
    assert record.transfer_id
