"""Automated trip payment reconciliation + driver payout."""

from __future__ import annotations

import logging
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any

from app.firestore_db import FirestoreDB
from app.stripe_service import StripeService, get_stripe

logger = logging.getLogger(__name__)


class ReconciliationNotReady(ValueError):
    pass


class ReconciliationInProgress(ReconciliationNotReady):
    pass

def calculate_fare_split(amount_cents: int, driver_share_bps: int) -> tuple[int, int]:
    if amount_cents < 0:
        raise ValueError("Fare amount cannot be negative")
    if not 0 <= driver_share_bps <= 10000:
        raise ValueError("Driver share must be between 0 and 10000 basis points")
    driver_payout = (amount_cents * driver_share_bps + 5000) // 10000
    return driver_payout, amount_cents - driver_payout


@dataclass
class ReconciliationRecord:
    trip_id: str
    passenger_id: str
    driver_id: str | None
    amount_cents: int
    driver_share_bps: int
    driver_payout_cents: int
    platform_fee_cents: int
    currency: str
    payment_intent_id: str | None
    transfer_id: str | None
    status: str
    reconciled_at: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class PaymentReconciliation:
    def __init__(self, stripe: StripeService | None = None) -> None:
        self.stripe = stripe or get_stripe()

    async def reconcile_trip(
        self,
        db: FirestoreDB,
        trip_id: str,
        *,
        driver_stripe_account_id: str | None = None,
        instant_payout: bool = True,
    ) -> ReconciliationRecord:
        trip = await db.get_trip(trip_id)
        if not trip:
            raise ValueError(f"Trip not found: {trip_id}")
        if trip.status.value != "completed":
            raise ReconciliationNotReady("Trip must be completed before reconciliation")
        if trip.payment_status.value != "captured":
            raise ReconciliationNotReady("Trip payment must be captured before reconciliation")
        if not trip.driver_id:
            raise ReconciliationNotReady("Trip must have an assigned driver before reconciliation")

        amount = int(
            trip.fare_final_cents
            if trip.fare_final_cents is not None
            else trip.fare_estimate_cents or 0
        )
        driver_share_bps = trip.driver_share_bps
        if driver_share_bps is None:
            driver_share_bps = db.settings.default_driver_share_bps
        driver_payout, platform_fee = calculate_fare_split(amount, driver_share_bps)

        idempotency_key = f"reconciliation:{trip_id}"
        if trip.reconciliation_status == "reconciled":
            reconstructed = ReconciliationRecord(
                trip_id=trip_id,
                passenger_id=trip.rider_id,
                driver_id=trip.driver_id,
                amount_cents=amount,
                driver_share_bps=driver_share_bps,
                driver_payout_cents=int(trip.driver_payout_cents or driver_payout),
                platform_fee_cents=int(trip.platform_fee_cents or platform_fee),
                currency=(trip.currency or "zar").upper(),
                payment_intent_id=trip.payment_intent_id,
                transfer_id=trip.transfer_id,
                status="reconciled",
                reconciled_at=(trip.reconciled_at or datetime.now(timezone.utc)).isoformat(),
            ).to_dict()
            canonical = await db.create_or_get_payment_record(idempotency_key, reconstructed)
            return ReconciliationRecord(**canonical)

        existing = await db.get_payment_record(idempotency_key)
        if existing:
            await db.update_trip(
                trip_id,
                {
                    "reconciliation_status": "reconciled",
                    "reconciliation_error": None,
                    "driver_payout_cents": existing["driver_payout_cents"],
                    "platform_fee_cents": existing["platform_fee_cents"],
                    "transfer_id": existing.get("transfer_id"),
                    "reconciled_at": existing["reconciled_at"],
                },
            )
            return ReconciliationRecord(**existing)

        claimed = await db.claim_reconciliation_attempt(trip_id)
        if not claimed:
            raise ReconciliationInProgress("Payout reconciliation is already in progress")
        trip = claimed
        try:
            transfer_id = None
            if trip.driver_id and driver_payout > 0 and instant_payout:
                driver = await db.get_driver(trip.driver_id)
                dest = driver_stripe_account_id or (driver.stripe_account_id if driver else None)
                if self.stripe.enabled and not dest:
                    raise ReconciliationNotReady("Driver payout account is not configured")
                dest = dest or f"acct_dev_{trip.driver_id[:8]}"
                transfer = await self.stripe.transfer_to_driver(driver_payout, dest, trip_id)
                transfer_id = transfer.get("id")

            record = ReconciliationRecord(
                trip_id=trip_id,
                passenger_id=trip.rider_id,
                driver_id=trip.driver_id,
                amount_cents=amount,
                driver_share_bps=driver_share_bps,
                driver_payout_cents=driver_payout,
                platform_fee_cents=platform_fee,
                currency=(trip.currency or "zar").upper(),
                payment_intent_id=trip.payment_intent_id,
                transfer_id=transfer_id,
                status="reconciled",
                reconciled_at=datetime.now(timezone.utc).isoformat(),
            )
            canonical = await db.create_or_get_payment_record(idempotency_key, record.to_dict())
            await db.update_trip(
                trip_id,
                {
                    "payment_status": "captured",
                    "reconciliation_status": "reconciled",
                    "reconciliation_error": None,
                    "driver_share_bps": driver_share_bps,
                    "driver_payout_cents": canonical["driver_payout_cents"],
                    "platform_fee_cents": canonical["platform_fee_cents"],
                    "transfer_id": canonical.get("transfer_id"),
                    "reconciled_at": canonical["reconciled_at"],
                },
            )
        except Exception as exc:
            current = await db.get_trip(trip_id)
            if not current or current.reconciliation_status != "reconciled":
                message = f"{type(exc).__name__}: {str(exc)}"[:500]
                await db.update_trip(
                    trip_id,
                    {"reconciliation_status": "failed", "reconciliation_error": message},
                )
            raise
        logger.info("Reconciled trip=%s payout=%s", trip_id, driver_payout)
        return ReconciliationRecord(**canonical)


_recon: PaymentReconciliation | None = None


def get_reconciliation() -> PaymentReconciliation:
    global _recon
    if _recon is None:
        _recon = PaymentReconciliation()
    return _recon
