"""Automated trip payment reconciliation + driver payout."""

from __future__ import annotations

import logging
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any

from app.firestore_db import FirestoreDB
from app.stripe_service import StripeService, get_stripe

logger = logging.getLogger(__name__)

# Platform take rate (SA default)
PLATFORM_FEE_RATE = 0.15


@dataclass
class ReconciliationRecord:
    trip_id: str
    passenger_id: str
    driver_id: str | None
    amount_cents: int
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
        self._ledger: list[dict[str, Any]] = []

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

        amount = int(trip.fare_final_cents or trip.fare_estimate_cents or 0)
        platform_fee = int(round(amount * PLATFORM_FEE_RATE))
        driver_payout = max(0, amount - platform_fee)

        transfer_id = None
        if trip.driver_id and driver_payout > 0 and instant_payout:
            dest = driver_stripe_account_id or f"acct_dev_{trip.driver_id[:8]}"
            transfer = await self.stripe.transfer_to_driver(driver_payout, dest, trip_id)
            transfer_id = transfer.get("id")

        record = ReconciliationRecord(
            trip_id=trip_id,
            passenger_id=trip.rider_id,
            driver_id=trip.driver_id,
            amount_cents=amount,
            driver_payout_cents=driver_payout,
            platform_fee_cents=platform_fee,
            currency=(trip.currency or "zar").upper(),
            payment_intent_id=trip.payment_intent_id,
            transfer_id=transfer_id,
            status="reconciled",
            reconciled_at=datetime.now(timezone.utc).isoformat(),
        )
        payload = record.to_dict()
        self._ledger.append(payload)
        await db.update_trip(
            trip_id,
            {
                "payment_status": "captured",
                "reconciliation_status": "reconciled",
                "driver_payout_cents": driver_payout,
                "platform_fee_cents": platform_fee,
            },
        )
        logger.info("Reconciled trip=%s payout=%s", trip_id, driver_payout)
        return record

    def list_ledger(self, limit: int = 50) -> list[dict[str, Any]]:
        return list(reversed(self._ledger[-limit:]))


_recon: PaymentReconciliation | None = None


def get_reconciliation() -> PaymentReconciliation:
    global _recon
    if _recon is None:
        _recon = PaymentReconciliation()
    return _recon
