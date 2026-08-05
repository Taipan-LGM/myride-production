from __future__ import annotations

import pytest

from app.firestore_db import FirestoreDB
from app.config import Settings
from app.models import GeoPoint, PaymentStatus, TripStatus
from app.reconciliation import PaymentReconciliation, ReconciliationNotReady, calculate_fare_split


def test_fare_split_uses_integer_cents_and_preserves_total():
    driver_payout, platform_fee = calculate_fare_split(10001, 8500)
    assert driver_payout == 8501
    assert platform_fee == 1500
    assert driver_payout + platform_fee == 10001
    assert calculate_fare_split(1, 5000) == (1, 0)


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
            "driver_share_bps": 8500,
            "currency": "zar",
            "status": TripStatus.completed.value,
            "payment_status": PaymentStatus.captured.value,
        }
    )
    recon = PaymentReconciliation()
    record = await recon.reconcile_trip(db, trip.id)
    assert record.amount_cents == 10000
    assert trip.driver_share_bps == 8500
    assert record.driver_share_bps == 8500
    assert record.platform_fee_cents == 1500
    assert record.driver_payout_cents == 8500
    assert record.status == "reconciled"
    assert record.transfer_id

    repeated = await PaymentReconciliation().reconcile_trip(db, trip.id)
    assert repeated.to_dict() == record.to_dict()
    matching = [item for item in await db.list_payment_records() if item["trip_id"] == trip.id]
    assert matching == [record.to_dict()]


@pytest.mark.asyncio
async def test_reconcile_uses_trip_policy_snapshot_when_default_changes():
    original_settings = Settings(_env_file=None, default_driver_share_bps=8250)
    db = FirestoreDB(original_settings)
    await db.connect()
    trip = await db.create_trip(
        {
            "id": "trip-recon-snapshot",
            "rider_id": "r1",
            "driver_id": "d1",
            "pickup": {"lat": -33.92, "lng": 18.42},
            "dropoff": {"lat": -33.91, "lng": 18.41},
            "fare_final_cents": 10000,
            "driver_share_bps": 8250,
            "remuneration_policy_version": 1,
            "status": TripStatus.completed.value,
            "payment_status": PaymentStatus.captured.value,
        }
    )
    db.settings = Settings(_env_file=None, default_driver_share_bps=9000)

    record = await PaymentReconciliation().reconcile_trip(db, trip.id)

    assert record.driver_share_bps == 8250
    assert record.driver_payout_cents == 8250
    assert record.platform_fee_cents == 1750
    with pytest.raises(ValueError, match="immutable"):
        await db.update_trip(trip.id, {"driver_share_bps": 9000})


@pytest.mark.asyncio
async def test_reconciliation_rejects_incomplete_or_uncaptured_trip():
    db = FirestoreDB()
    await db.connect()
    trip = await db.create_trip(
        {
            "id": "trip-recon-not-ready",
            "rider_id": "r1",
            "driver_id": "d1",
            "pickup": {"lat": -33.92, "lng": 18.42},
            "dropoff": {"lat": -33.91, "lng": 18.41},
            "fare_estimate_cents": 10000,
        }
    )

    with pytest.raises(ReconciliationNotReady, match="completed"):
        await PaymentReconciliation().reconcile_trip(db, trip.id)

    await db.update_trip(trip.id, {"status": TripStatus.completed.value})
    with pytest.raises(ReconciliationNotReady, match="captured"):
        await PaymentReconciliation().reconcile_trip(db, trip.id)


@pytest.mark.asyncio
async def test_live_reconciliation_requires_driver_payout_account():
    class LiveStripe:
        enabled = True

        async def transfer_to_driver(self, *_args):
            raise AssertionError("transfer must not run without a payout account")

    db = FirestoreDB()
    await db.connect()
    trip = await db.create_trip(
        {
            "id": "trip-recon-no-account",
            "rider_id": "r1",
            "driver_id": "driver-no-account",
            "pickup": {"lat": -33.92, "lng": 18.42},
            "dropoff": {"lat": -33.91, "lng": 18.41},
            "fare_final_cents": 10000,
            "status": TripStatus.completed.value,
            "payment_status": PaymentStatus.captured.value,
        }
    )

    with pytest.raises(ReconciliationNotReady, match="payout account"):
        await PaymentReconciliation(stripe=LiveStripe()).reconcile_trip(db, trip.id)

    failed = await db.get_trip(trip.id)
    assert failed is not None
    assert failed.reconciliation_status == "failed"
    assert failed.reconciliation_attempt_count == 1
    assert failed.reconciliation_attempted_at is not None
    assert failed.reconciliation_error == "ReconciliationNotReady: Driver payout account is not configured"


@pytest.mark.asyncio
async def test_failed_reconciliation_retry_clears_operational_error():
    class FlakyStripe:
        enabled = False
        calls = 0

        async def transfer_to_driver(self, amount_cents, account_id, trip_id):
            self.calls += 1
            if self.calls == 1:
                raise RuntimeError("provider temporarily unavailable")
            return {"id": f"tr_{trip_id}"}

    db = FirestoreDB()
    await db.connect()
    trip = await db.create_trip(
        {
            "id": "trip-recon-retry-state",
            "rider_id": "r1",
            "driver_id": "d1",
            "pickup": {"lat": -33.92, "lng": 18.42},
            "dropoff": {"lat": -33.91, "lng": 18.41},
            "fare_final_cents": 10000,
            "status": TripStatus.completed.value,
            "payment_status": PaymentStatus.captured.value,
        }
    )
    reconciliation = PaymentReconciliation(stripe=FlakyStripe())

    with pytest.raises(RuntimeError, match="temporarily unavailable"):
        await reconciliation.reconcile_trip(db, trip.id)
    failed = await db.get_trip(trip.id)
    assert failed is not None
    assert failed.reconciliation_status == "failed"
    assert failed.reconciliation_attempt_count == 1

    record = await reconciliation.reconcile_trip(db, trip.id)
    retried = await db.get_trip(trip.id)
    assert record.status == "reconciled"
    assert retried is not None
    assert retried.reconciliation_status == "reconciled"
    assert retried.reconciliation_attempt_count == 2
    assert retried.reconciliation_error is None
