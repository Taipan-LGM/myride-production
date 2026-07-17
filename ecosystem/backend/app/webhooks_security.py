"""Webhook signature verification — Stripe + Twilio (no fake accepts in production)."""

from __future__ import annotations

import logging
from typing import Any
from urllib.parse import parse_qsl

from fastapi import HTTPException, Request

from app.config import Settings, get_settings
from app.stripe_service import get_stripe

logger = logging.getLogger(__name__)


def verify_stripe_webhook(payload: bytes, sig_header: str, settings: Settings | None = None) -> dict[str, Any]:
    """Verify Stripe signature. Dev without secret returns a stub event; prod requires secret."""
    settings = settings or get_settings()
    stripe = get_stripe()
    if not stripe.enabled:
        if settings.environment == "production":
            raise HTTPException(503, "Stripe not configured")
        return {"type": "dev.webhook", "data": {"object": {}}, "dev_mode": True}

    if not settings.stripe_webhook_secret:
        if settings.environment == "production":
            raise HTTPException(503, "STRIPE_WEBHOOK_SECRET required in production")
        logger.warning("Stripe webhook secret unset — accepting unsigned event (dev only)")
        return {"type": "dev.webhook.unsigned", "data": {"object": {}}, "dev_mode": True}

    if not sig_header:
        raise HTTPException(400, "Missing Stripe-Signature header")

    try:
        event = stripe.construct_webhook_event(payload, sig_header)
    except Exception as exc:
        logger.warning("Stripe webhook signature failed: %s", exc)
        raise HTTPException(400, "Invalid Stripe signature") from exc

    if hasattr(event, "to_dict"):
        return event.to_dict()
    if isinstance(event, dict):
        return event
    return {"type": getattr(event, "type", "unknown"), "id": getattr(event, "id", None)}


async def verify_twilio_request(request: Request, settings: Settings | None = None) -> dict[str, str]:
    """Validate X-Twilio-Signature when auth token is set. Returns parsed form fields."""
    settings = settings or get_settings()
    body = await request.body()
    form_pairs = parse_qsl(body.decode("utf-8"), keep_blank_values=True)
    params = {k: v for k, v in form_pairs}

    token = (settings.twilio_auth_token or "").strip()
    if not token:
        if settings.environment == "production":
            raise HTTPException(503, "TWILIO_AUTH_TOKEN required in production for webhooks")
        return params

    signature = request.headers.get("X-Twilio-Signature") or request.headers.get("x-twilio-signature") or ""
    if not signature:
        raise HTTPException(400, "Missing X-Twilio-Signature")

    # Twilio signs the full public URL of the webhook
    base = (settings.public_base_url or "").rstrip("/")
    path = request.url.path
    url = f"{base}{path}"
    try:
        from twilio.request_validator import RequestValidator

        ok = RequestValidator(token).validate(url, params, signature)
    except Exception as exc:
        logger.warning("Twilio validator error: %s", exc)
        raise HTTPException(400, "Twilio validation failed") from exc

    if not ok:
        # Retry with query string if present (some proxies append)
        q = request.url.query
        if q:
            ok = RequestValidator(token).validate(f"{url}?{q}", params, signature)
    if not ok:
        logger.warning("Twilio signature mismatch url=%s", url)
        raise HTTPException(403, "Invalid Twilio signature")
    return params
