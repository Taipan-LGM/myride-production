from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.firestore_db import FirestoreDB
import app.main as main_module
from app.main import app
from app.models import PaymentStatus, TripStatus
from app.refunds import RefundService


class FakeRefundStripe:
    enabled = True

    def __init__(self) -> None:
        self.reversals = 0
        self.refunds = 0

    async def reverse_driver_transfer(self, transfer_id, amount_cents, trip_id):
        self.reversals += 1
        return {"id": "trr_test", "amount": amount_cents}

    async def refund_payment_intent(self, payment_intent_id, amount_cents, trip_id, reason):
        self.refunds += 1
        return {"id": "re_test", "amount": amount_cents, "status": "succeeded"}


@pytest.mark.asyncio
async def test_full_refund_reverses_payout_and_is_idempotent():
    db = FirestoreDB()
    await db.connect()
    trip = await db.create_trip(
        {
            "id": "trip-refund-full",
            "rider_id": "rider-1",
            "driver_id": "driver-1",
            "pickup": {"lat": -33.92, "lng": 18.42},
            "dropoff": {"lat": -33.91, "lng": 18.41},
            "fare_final_cents": 10000,
            "driver_payout_cents": 8500,
            "platform_fee_cents": 1500,
            "payment_intent_id": "pi_test",
            "transfer_id": "tr_test",
            "status": TripStatus.completed.value,
            "payment_status": PaymentStatus.captured.value,
            "reconciliation_status": "reconciled",
        }
    )
    stripe = FakeRefundStripe()
    service = RefundService(stripe=stripe)

    first = await service.refund_trip(db, trip.id, "admin-1", "service recovery")
    repeated = await service.refund_trip(db, trip.id, "admin-1", "service recovery")

    assert first == repeated
    assert first["status"] == "refunded"
    assert first["amount_cents"] == 10000
    assert first["refund_id"] == "re_test"
    assert first["transfer_reversal_id"] == "trr_test"
    assert stripe.reversals == 1
    assert stripe.refunds == 1
    updated = await db.get_trip(trip.id)
    assert updated is not None
    assert updated.payment_status == PaymentStatus.refunded

    assert updated.refund_attempt_count == 1
    matching = [item for item in await db.list_payment_records() if item["trip_id"] == trip.id]
    assert matching == [first]


@pytest.mark.asyncio
async def test_refund_retry_does_not_repeat_completed_reversal():
    class RefundFailsOnce(FakeRefundStripe):
        async def refund_payment_intent(self, payment_intent_id, amount_cents, trip_id, reason):
            self.refunds += 1
            if self.refunds == 1:
                raise RuntimeError("temporary refund outage")
            return {"id": "re_retry", "amount": amount_cents, "status": "succeeded"}

    db = FirestoreDB()
    await db.connect()
    trip = await db.create_trip(
        {
            "id": "trip-refund-resume",
            "rider_id": "rider-1",
            "driver_id": "driver-1",
            "pickup": {"lat": -33.92, "lng": 18.42},
            "dropoff": {"lat": -33.91, "lng": 18.41},
            "fare_final_cents": 10000,
            "driver_payout_cents": 8500,
            "payment_intent_id": "pi_retry",
            "transfer_id": "tr_retry",
            "status": TripStatus.completed.value,
            "payment_status": PaymentStatus.captured.value,
            "reconciliation_status": "reconciled",
        }
    )
    stripe = RefundFailsOnce()
    service = RefundService(stripe=stripe)

    with pytest.raises(RuntimeError, match="temporary refund outage"):
        await service.refund_trip(db, trip.id, "admin-1", "service recovery")
    failed = await db.get_trip(trip.id)
    assert failed is not None
    assert failed.refund_status == "failed"
    assert failed.transfer_reversal_id == "trr_test"

    result = await service.refund_trip(db, trip.id, "admin-1", "service recovery")
    assert result["refund_id"] == "re_retry"
    assert stripe.reversals == 1
    assert stripe.refunds == 2


@pytest.mark.asyncio
async def test_pending_refund_retry_waits_for_provider_webhook():
    class PendingRefundStripe(FakeRefundStripe):
        async def refund_payment_intent(self, payment_intent_id, amount_cents, trip_id, reason):
            self.refunds += 1
            return {"id": "re_pending", "amount": amount_cents, "status": "pending"}

    db = FirestoreDB()
    await db.connect()
    trip = await db.create_trip(
        {
            "id": "trip-refund-pending",
            "rider_id": "rider-1",
            "pickup": {"lat": -33.92, "lng": 18.42},
            "dropoff": {"lat": -33.91, "lng": 18.41},
            "fare_final_cents": 10000,
            "payment_intent_id": "pi_pending",
            "status": TripStatus.completed.value,
            "payment_status": PaymentStatus.captured.value,
        }
    )
    stripe = PendingRefundStripe()
    service = RefundService(stripe=stripe)

    first = await service.refund_trip(db, trip.id, "admin-1", "service recovery")
    repeated = await service.refund_trip(db, trip.id, "admin-1", "service recovery")

    assert first == repeated
    assert repeated["status"] == "pending"
    assert stripe.refunds == 1
    updated = await db.get_trip(trip.id)
    assert updated is not None
    assert updated.payment_status == PaymentStatus.captured
    assert updated.refund_status == "pending"
    records = await db.list_payment_records()
    assert [record for record in records if record["trip_id"] == trip.id] == []


def test_refund_endpoint_is_admin_only(monkeypatch):
    class FakeService:
        async def refund_trip(self, db, trip_id, actor_id, reason):
            return {"trip_id": trip_id, "status": "refunded", "amount_cents": 10000}

    monkeypatch.setattr(main_module, "get_refund_service", lambda: FakeService())
    with TestClient(app) as client:
        rider_login = client.post(
            "/auth/login",
            json={"identifier": "rider@myride.co.za", "password": "ride123", "role": "rider"},
        ).json()
        admin_login = client.post(
            "/auth/login",
            json={"identifier": "admin@myride.co.za", "password": "admin123", "role": "admin"},
        ).json()
        body = {"reason": "customer service recovery"}

        forbidden = client.post(
            "/payments/refund/trip-1",
            headers={"Authorization": f"Bearer {rider_login['access_token']}"},
            json=body,
        )
        refunded = client.post(
            "/payments/refund/trip-1",
            headers={"Authorization": f"Bearer {admin_login['access_token']}"},
            json=body,
        )

        assert forbidden.status_code == 403
        assert refunded.status_code == 200
        assert refunded.json()["status"] == "refunded"


@pytest.mark.asyncio
async def test_pending_refund_finalizes_from_provider_update():
    db = FirestoreDB()
    await db.connect()
    trip = await db.create_trip(
        {
            "id": "trip-refund-webhook",
            "rider_id": "rider-1",
            "pickup": {"lat": -33.92, "lng": 18.42},
            "dropoff": {"lat": -33.91, "lng": 18.41},
            "fare_final_cents": 10000,
            "payment_intent_id": "pi_webhook",
            "refund_id": "re_pending",
            "refund_status": "pending",
            "status": TripStatus.completed.value,
            "payment_status": PaymentStatus.captured.value,
        }
    )

    record = await RefundService(stripe=FakeRefundStripe()).finalize_refund(
        db, trip.id, "re_pending", 10000
    )

    assert record["status"] == "refunded"
    updated = await db.get_trip(trip.id)
    assert updated is not None
    assert updated.payment_status == PaymentStatus.refunded

    repeated = await RefundService(stripe=FakeRefundStripe()).finalize_refund(
        db, trip.id, "re_pending", 10000
    )
    assert repeated == record