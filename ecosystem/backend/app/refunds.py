from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.firestore_db import FirestoreDB
from app.stripe_service import StripeService, get_stripe


class RefundNotReady(ValueError):
    pass


class RefundInProgress(RefundNotReady):
    pass


class RefundService:
    def __init__(self, stripe: StripeService | None = None) -> None:
        self.stripe = stripe or get_stripe()

    async def refund_trip(self, db: FirestoreDB, trip_id: str, actor_id: str, reason: str) -> dict[str, Any]:
        trip = await db.get_trip(trip_id)
        if not trip:
            raise ValueError(f"Trip not found: {trip_id}")
        if trip.refund_status == "refunded":
            record = self._record(trip, actor_id, reason)
            return await db.create_or_get_payment_record(f"refund:{trip.id}:full", record, "refund")
        if trip.refund_status == "pending" and trip.refund_id:
            return {
                "trip_id": trip.id,
                "kind": "refund",
                "status": "pending",
                "amount_cents": int(trip.fare_final_cents or trip.fare_estimate_cents or 0),
                "currency": trip.currency.upper(),
                "refund_id": trip.refund_id,
                "transfer_reversal_id": trip.transfer_reversal_id,
            }
        if trip.payment_status.value != "captured":
            raise RefundNotReady("Trip payment must be captured before refund")
        if not trip.payment_intent_id:
            raise RefundNotReady("Trip has no captured payment reference")

        claimed = await db.claim_refund_attempt(trip_id)
        if not claimed:
            raise RefundInProgress("Trip refund is already in progress")
        trip = claimed
        amount = int(trip.fare_final_cents or trip.fare_estimate_cents or 0)
        try:
            reversal_id = trip.transfer_reversal_id
            if trip.transfer_id and int(trip.driver_payout_cents or 0) > 0 and not reversal_id:
                reversal = await self.stripe.reverse_driver_transfer(
                    trip.transfer_id,
                    int(trip.driver_payout_cents or 0),
                    trip.id,
                )
                reversal_id = reversal["id"]
                await db.update_trip(
                    trip.id,
                    {"transfer_reversal_id": reversal_id, "reconciliation_status": "reversed"},
                )

            refund_id = trip.refund_id
            if not refund_id:
                refund = await self.stripe.refund_payment_intent(
                    trip.payment_intent_id,
                    amount,
                    trip.id,
                    reason,
                )
                refund_id = refund["id"]
                if refund.get("status") != "succeeded":
                    await db.update_trip(
                        trip.id,
                        {
                            "refund_id": refund_id,
                            "refund_status": "pending",
                            "refund_error": None,
                            "refund_reason": reason,
                            "refunded_by": actor_id,
                        },
                    )
                    return {
                        "trip_id": trip.id,
                        "kind": "refund",
                        "status": "pending",
                        "amount_cents": amount,
                        "currency": trip.currency.upper(),
                        "refund_id": refund_id,
                        "transfer_reversal_id": reversal_id,
                    }
            refunded_at = datetime.now(timezone.utc).isoformat()
            await db.update_trip(
                trip.id,
                {
                    "payment_status": "refunded",
                    "reconciliation_status": "reversed" if reversal_id else trip.reconciliation_status,
                    "refund_status": "refunded",
                    "refund_error": None,
                    "refund_id": refund_id,
                    "transfer_reversal_id": reversal_id,
                    "refunded_amount_cents": amount,
                    "refunded_at": refunded_at,
                    "refund_reason": reason,
                    "refunded_by": actor_id,
                },
            )
        except Exception as exc:
            current = await db.get_trip(trip.id)
            if not current or current.refund_status != "refunded":
                await db.update_trip(
                    trip.id,
                    {"refund_status": "failed", "refund_error": f"{type(exc).__name__}: {str(exc)}"[:500]},
                )
            raise
        updated = await db.get_trip(trip.id)
        if not updated:
            raise RuntimeError("Refund completed but trip could not be reloaded")
        record = self._record(updated, actor_id, reason)
        return await db.create_or_get_payment_record(f"refund:{trip.id}:full", record, "refund")

    async def finalize_refund(
        self,
        db: FirestoreDB,
        trip_id: str,
        refund_id: str,
        amount_cents: int,
    ) -> dict[str, Any]:
        trip = await db.get_trip(trip_id)
        if not trip:
            raise ValueError(f"Trip not found: {trip_id}")
        if trip.refund_id and trip.refund_id != refund_id:
            raise RefundNotReady("Refund reference does not match trip")
        expected_amount = int(trip.fare_final_cents or trip.fare_estimate_cents or 0)
        if amount_cents != expected_amount:
            raise RefundNotReady("Refund amount does not match trip fare")
        if trip.refund_status == "refunded":
            record = self._record(trip, "stripe-webhook", "provider update")
            return await db.create_or_get_payment_record(f"refund:{trip.id}:full", record, "refund")
        refunded_at = datetime.now(timezone.utc).isoformat()
        await db.update_trip(
            trip.id,
            {
                "payment_status": "refunded",
                "refund_status": "refunded",
                "refund_error": None,
                "refund_id": refund_id,
                "refunded_amount_cents": amount_cents,
                "refunded_at": refunded_at,
                "reconciliation_status": "reversed" if trip.transfer_reversal_id else trip.reconciliation_status,
            },
        )
        updated = await db.get_trip(trip.id)
        if not updated:
            raise RuntimeError("Refund finalized but trip could not be reloaded")
        record = self._record(updated, "stripe-webhook", getattr(updated, "refund_reason", "provider update"))
        return await db.create_or_get_payment_record(f"refund:{trip.id}:full", record, "refund")

    @staticmethod
    def _record(trip, actor_id: str, reason: str) -> dict[str, Any]:
        return {
            "trip_id": trip.id,
            "kind": "refund",
            "status": "refunded",
            "amount_cents": int(trip.refunded_amount_cents or trip.fare_final_cents or trip.fare_estimate_cents or 0),
            "currency": trip.currency.upper(),
            "refund_id": trip.refund_id,
            "transfer_reversal_id": trip.transfer_reversal_id,
            "driver_payout_cents": int(trip.driver_payout_cents or 0),
            "platform_fee_cents": int(trip.platform_fee_cents or 0),
            "refunded_at": trip.refunded_at.isoformat() if trip.refunded_at else None,
            "reason": getattr(trip, "refund_reason", reason),
            "refunded_by": getattr(trip, "refunded_by", actor_id),
        }


_refund_service: RefundService | None = None


def get_refund_service() -> RefundService:
    global _refund_service
    if _refund_service is None:
        _refund_service = RefundService()
    return _refund_service