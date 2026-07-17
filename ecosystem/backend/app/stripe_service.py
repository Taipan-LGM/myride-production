from __future__ import annotations

import logging

from app.config import Settings, get_settings

logger = logging.getLogger(__name__)


class StripeService:
    """PaymentIntents with manual capture (hold), capture, transfers, webhook verify.

    Hybrid mode: development uses STRIPE_TEST_SECRET_KEY or STRIPE_SECRET_KEY;
    production uses STRIPE_LIVE_SECRET_KEY when set.
    """

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        secret = self._resolve_secret()
        self._enabled = bool(secret)
        self.mode = "live" if self.settings.environment == "production" and self.settings.stripe_live_secret_key else "test"
        if self._enabled:
            import stripe

            stripe.api_key = secret
            self._stripe = stripe
        else:
            self._stripe = None
            logger.warning("Stripe: disabled (set STRIPE_SECRET_KEY or STRIPE_TEST_SECRET_KEY)")

    def _resolve_secret(self) -> str:
        if self.settings.environment == "production" and self.settings.stripe_live_secret_key:
            return self.settings.stripe_live_secret_key
        return (
            self.settings.stripe_test_secret_key
            or self.settings.stripe_secret_key
            or ""
        )

    @property
    def enabled(self) -> bool:
        return self._enabled

    async def create_hold(
        self,
        amount_cents: int,
        rider_id: str,
        trip_id: str,
        currency: str | None = None,
    ) -> dict:
        currency = currency or self.settings.stripe_currency
        if not self._enabled:
            return {
                "id": f"pi_dev_{trip_id[:8]}",
                "status": "requires_capture",
                "amount": amount_cents,
                "currency": currency,
                "dev_mode": True,
            }
        intent = self._stripe.PaymentIntent.create(
            amount=amount_cents,
            currency=currency,
            capture_method="manual",
            metadata={"rider_id": rider_id, "trip_id": trip_id},
            automatic_payment_methods={"enabled": True},
        )
        return {"id": intent.id, "status": intent.status, "client_secret": intent.client_secret}

    async def capture(self, payment_intent_id: str, amount_cents: int | None = None) -> dict:
        if not self._enabled:
            return {"id": payment_intent_id, "status": "succeeded", "dev_mode": True}
        kwargs = {}
        if amount_cents is not None:
            kwargs["amount_to_capture"] = amount_cents
        intent = self._stripe.PaymentIntent.capture(payment_intent_id, **kwargs)
        return {"id": intent.id, "status": intent.status}

    async def transfer_to_driver(
        self,
        amount_cents: int,
        driver_stripe_account_id: str,
        trip_id: str,
    ) -> dict:
        if not self._enabled:
            return {
                "id": f"tr_dev_{trip_id[:8]}",
                "amount": amount_cents,
                "destination": driver_stripe_account_id,
                "dev_mode": True,
            }
        transfer = self._stripe.Transfer.create(
            amount=amount_cents,
            currency=self.settings.stripe_currency,
            destination=driver_stripe_account_id,
            metadata={"trip_id": trip_id},
        )
        return {"id": transfer.id, "amount": transfer.amount}

    def construct_webhook_event(self, payload: bytes, sig_header: str):
        """Verify Stripe signature. Raises stripe.error.SignatureVerificationError on failure.

        Callers in production should require stripe_webhook_secret via webhooks_security.
        """
        if not self._enabled:
            return {"type": "dev.webhook", "data": {"object": {}}}
        if not self.settings.stripe_webhook_secret:
            return {"type": "dev.webhook.unsigned", "data": {"object": {}}}
        return self._stripe.Webhook.construct_event(
            payload,
            sig_header,
            self.settings.stripe_webhook_secret,
        )


_stripe: StripeService | None = None


def get_stripe() -> StripeService:
    global _stripe
    if _stripe is None:
        _stripe = StripeService()
    return _stripe
