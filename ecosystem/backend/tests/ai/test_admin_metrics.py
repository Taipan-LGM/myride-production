from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.admin_metrics import collect_admin_metrics
from app.firestore_db import FirestoreDB
from app.models import GeoPoint, TripStatus


@pytest.mark.asyncio
async def test_admin_metrics_shape():
    db = FirestoreDB()
    await db.connect()
    await db.create_driver(
        {
            "id": "d-metrics",
            "name": "M",
            "phone": "+27000000000",
            "location": GeoPoint(lat=-33.92, lng=18.42).model_dump(),
            "is_online": True,
        }
    )
    await db.create_trip(
        {
            "id": "trip-admin-metrics-split",
            "rider_id": "r-metrics",
            "driver_id": "d-metrics",
            "pickup": {"lat": -33.92, "lng": 18.42},
            "dropoff": {"lat": -33.91, "lng": 18.41},
            "fare_final_cents": 10000,
            "driver_payout_cents": 8500,
            "platform_fee_cents": 1500,
            "status": TripStatus.completed.value,
        }
    )
    metrics = await collect_admin_metrics(db)
    assert "live_rides" in metrics
    assert "active_drivers" in metrics
    assert metrics["currency"] == "ZAR"
    assert metrics["ai_resolution_rate"] >= 0
    assert "financial_period_start" in metrics


@pytest.mark.asyncio
async def test_admin_financial_metrics_use_sast_calendar_day():
    class MetricsDB:
        async def list_trips(self, limit):
            return []

        async def list_online_drivers(self):
            return []

        async def list_payment_records_since(self, since):
            assert since == datetime(2026, 8, 4, 22, tzinfo=timezone.utc)
            return [
                {
                    "amount_cents": 10000,
                    "driver_payout_cents": 8500,
                    "platform_fee_cents": 1500,
                    "reconciled_at": "2026-08-04T22:00:00+00:00",
                }
            ]

        async def list_payment_records(self, limit):
            return []

    metrics = await collect_admin_metrics(MetricsDB(), now=datetime(2026, 8, 5, 10, tzinfo=timezone.utc))

    assert metrics["financial_period_start"] == "2026-08-04T22:00:00+00:00"
    assert metrics["gross_booking_value_zar"] == 100
    assert metrics["platform_revenue_zar"] == 15
    assert metrics["driver_payouts_zar"] == 85


@pytest.mark.asyncio
async def test_admin_financial_metrics_net_full_refunds():
    class MetricsDB:
        async def list_trips(self, limit):
            return []

        async def list_online_drivers(self):
            return []

        async def list_payment_records_since(self, since):
            return [
                {
                    "amount_cents": 10000,
                    "driver_payout_cents": 8500,
                    "platform_fee_cents": 1500,
                    "reconciled_at": "2026-08-05T09:00:00+00:00",
                },
                {
                    "kind": "refund",
                    "amount_cents": 10000,
                    "driver_payout_cents": 8500,
                    "platform_fee_cents": 1500,
                    "refunded_at": "2026-08-05T10:00:00+00:00",
                },
            ]

        async def list_payment_records(self, limit):
            return []

    metrics = await collect_admin_metrics(MetricsDB(), now=datetime(2026, 8, 5, 12, tzinfo=timezone.utc))

    assert metrics["gross_booking_value_zar"] == 0
    assert metrics["platform_revenue_zar"] == 0
    assert metrics["driver_payouts_zar"] == 0
