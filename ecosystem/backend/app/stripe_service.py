from __future__ import annotations

import asyncio
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

    @property
    def connect_available(self) -> bool:
        if not self._enabled:
            return True
        return self.settings.stripe_connect_country.upper() != "ZA" or self.settings.stripe_connect_za_approved

    def _require_connect_available(self) -> None:
        if not self.connect_available:
            raise RuntimeError("Stripe Connect for ZA requires prior Stripe approval")

    def _connect_urls(self) -> tuple[str, str]:
        base_url = self.settings.public_base_url.rstrip("/")
        refresh_url = self.settings.stripe_connect_refresh_url or f"{base_url}/?stripe_connect=refresh"
        return_url = self.settings.stripe_connect_return_url or f"{base_url}/?stripe_connect=return"
        if self.settings.environment == "production":
            if not refresh_url.startswith("https://") or not return_url.startswith("https://"):
                raise RuntimeError("Stripe Connect callback URLs must use HTTPS in production")
        return refresh_url, return_url

    async def create_connect_account(self, driver_id: str, email: str) -> dict:
        if not self._enabled:
            return {"id": f"acct_dev_{driver_id[:16]}", "dev_mode": True}
        self._require_connect_available()
        account = await asyncio.to_thread(
            self._stripe.Account.create,
            type="express",
            country=self.settings.stripe_connect_country.upper(),
            email=email,
            capabilities={"transfers": {"requested": True}},
            metadata={"driver_id": driver_id},
            idempotency_key=f"driver-connect-{driver_id}",
        )
        return {"id": account.id, "dev_mode": False}

    async def create_connect_account_link(self, account_id: str) -> dict:
        if not self._enabled:
            return {"url": None, "dev_mode": True}
        self._require_connect_available()
        refresh_url, return_url = self._connect_urls()
        link = await asyncio.to_thread(
            self._stripe.AccountLink.create,
            account=account_id,
            refresh_url=refresh_url,
            return_url=return_url,
            type="account_onboarding",
        )
        return {"url": link.url, "expires_at": link.expires_at, "dev_mode": False}

    async def create_connect_login_link(self, account_id: str) -> dict:
        if not self._enabled:
            return {"url": None, "dev_mode": True}
        self._require_connect_available()
        link = await asyncio.to_thread(self._stripe.Account.create_login_link, account_id)
        return {"url": link.url, "dev_mode": False}

    async def get_connect_account_status(self, account_id: str) -> dict:
        if not self._enabled:
            return {
                "details_submitted": True,
                "payouts_enabled": True,
                "charges_enabled": True,
                "dev_mode": True,
            }
        self._require_connect_available()
        account = await asyncio.to_thread(self._stripe.Account.retrieve, account_id)
        return {
            "details_submitted": bool(account.details_submitted),
            "payouts_enabled": bool(account.payouts_enabled),
            "charges_enabled": bool(account.charges_enabled),
            "dev_mode": False,
        }

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
        intent = await asyncio.to_thread(
            self._stripe.PaymentIntent.create,
            amount=amount_cents,
            currency=currency,
            capture_method="manual",
            metadata={"rider_id": rider_id, "trip_id": trip_id},
            automatic_payment_methods={"enabled": True},
            idempotency_key=f"trip-hold-{trip_id}",
        )
        return {"id": intent.id, "status": intent.status, "client_secret": intent.client_secret}

    async def capture(
        self,
        payment_intent_id: str,
        amount_cents: int | None = None,
        trip_id: str | None = None,
    ) -> dict:
        if not self._enabled:
            return {"id": payment_intent_id, "status": "succeeded", "dev_mode": True}
        kwargs = {}
        if amount_cents is not None:
            kwargs["amount_to_capture"] = amount_cents
        if trip_id:
            kwargs["idempotency_key"] = f"trip-capture-{trip_id}"
        intent = await asyncio.to_thread(self._stripe.PaymentIntent.capture, payment_intent_id, **kwargs)
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
            idempotency_key=f"trip-payout-{trip_id}",
        )
        return {"id": transfer.id, "amount": transfer.amount}

    async def reverse_driver_transfer(self, transfer_id: str, amount_cents: int, trip_id: str) -> dict:
        if not self._enabled:
            return {"id": f"trr_dev_{trip_id[:8]}", "amount": amount_cents, "dev_mode": True}
        reversal = await asyncio.to_thread(
            self._stripe.Transfer.create_reversal,
            transfer_id,
            amount=amount_cents,
            metadata={"trip_id": trip_id},
            idempotency_key=f"trip-refund-reversal-{trip_id}-full",
        )
        return {"id": reversal.id, "amount": reversal.amount}

    async def refund_payment_intent(
        self,
        payment_intent_id: str,
        amount_cents: int,
        trip_id: str,
        reason: str,
    ) -> dict:
        if not self._enabled:
            return {"id": f"re_dev_{trip_id[:8]}", "amount": amount_cents, "status": "succeeded", "dev_mode": True}
        refund = await asyncio.to_thread(
            self._stripe.Refund.create,
            payment_intent=payment_intent_id,
            amount=amount_cents,
            metadata={"trip_id": trip_id, "reason": reason[:200]},
            idempotency_key=f"trip-refund-{trip_id}-full",
        )
        return {"id": refund.id, "amount": refund.amount, "status": refund.status}

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
