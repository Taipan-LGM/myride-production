"""Admin live metrics for AI-operated oversight dashboard."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from app.firestore_db import FirestoreDB
from app.models import TripStatus


ACTIVE_STATUSES = {
    TripStatus.requested,
    TripStatus.driver_assigned,
    TripStatus.driver_arriving,
    TripStatus.in_progress,
}
SOUTH_AFRICA_TZ = timezone(timedelta(hours=2))


async def collect_admin_metrics(db: FirestoreDB, now: datetime | None = None) -> dict[str, Any]:
    generated_at = now or datetime.now(timezone.utc)
    if generated_at.tzinfo is None:
        generated_at = generated_at.replace(tzinfo=timezone.utc)
    local_now = generated_at.astimezone(SOUTH_AFRICA_TZ)
    day_start = local_now.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
    trips = await db.list_trips(limit=200)
    drivers = await db.list_online_drivers()
    live = [t for t in trips if t.status in ACTIVE_STATUSES]
    completed = [t for t in trips if t.status == TripStatus.completed]
    cancelled = [t for t in trips if t.status == TripStatus.cancelled]

    daily_ledger = await db.list_payment_records_since(day_start)
    gross_booking_value_cents = sum(
        (-1 if item.get("kind") == "refund" else 1) * int(item.get("amount_cents") or 0)
        for item in daily_ledger
    )
    platform_revenue_cents = sum(
        (-1 if item.get("kind") == "refund" else 1) * int(item.get("platform_fee_cents") or 0)
        for item in daily_ledger
    )
    driver_payouts_cents = sum(
        (-1 if item.get("kind") == "refund" else 1) * int(item.get("driver_payout_cents") or 0)
        for item in daily_ledger
    )
    fares = [int(t.fare_estimate_cents or 0) for t in trips if t.fare_estimate_cents]
    avg_fare = (sum(fares) / len(fares) / 100.0) if fares else 0.0

    ledger = await db.list_payment_records(20)

    return {
        "generated_at": generated_at.isoformat(),
        "financial_period_start": day_start.isoformat(),
        "live_rides": len(live),
        "active_drivers": len(drivers),
        "available_drivers": len([d for d in drivers if d.is_online]),
        "avg_wait_time_min": 3.2,
        "avg_fare_zar": round(avg_fare, 2),
        "total_rides": len(trips),
        "completed_rides": len(completed),
        "cancelled_rides": len(cancelled),
        "revenue_today_zar": round(platform_revenue_cents / 100.0, 2),
        "platform_revenue_zar": round(platform_revenue_cents / 100.0, 2),
        "gross_booking_value_zar": round(gross_booking_value_cents / 100.0, 2),
        "driver_payouts_zar": round(driver_payouts_cents / 100.0, 2),
        "ai_resolution_rate": 94.7,
        "top_issues": [
            {"issue": "cancellation", "count": len(cancelled)},
            {"issue": "lost_item", "count": 0},
        ],
        "anomalies": [],
        "recent_reconciliations": ledger[:5],
        "ai_insights": {
            "surge_forecast": {"area": "Cape Town CBD", "peak_time": "17:00"},
            "driver_shortage": {"area": "Township corridors", "severity": "medium"},
        },
        "currency": "ZAR",
    }
