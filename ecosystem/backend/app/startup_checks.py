"""Startup validation for production readiness."""

from __future__ import annotations

import logging
import os

from app.config import Settings

logger = logging.getLogger(__name__)


def validate_settings(settings: Settings) -> list[str]:
    """Return warnings. In production, CRITICAL items raise RuntimeError."""
    warnings: list[str] = []
    critical: list[str] = []
    if settings.environment == "production":
        if settings.jwt_secret.startswith("my-ride-sa-dev"):
            critical.append("CRITICAL: change JWT_SECRET in production")
        if len(settings.jwt_secret.strip()) < 32:
            critical.append("CRITICAL: JWT_SECRET must be ≥32 characters in production")
        if not (settings.stripe_live_secret_key or settings.stripe_secret_key):
            warnings.append("Stripe live/secret key missing in production")
        elif not settings.stripe_webhook_secret:
            critical.append("STRIPE_WEBHOOK_SECRET required when Stripe is configured in production")
        if not settings.twilio_account_sid or not settings.twilio_auth_token:
            warnings.append("Twilio unset — voice/WhatsApp webhooks will stay in mock mode")
        if settings.debug:
            critical.append("DEBUG=true in production")
        if settings.cors_origins.strip() in ("", "*"):
            critical.append("CORS_ORIGINS=* is unsafe in production")
        if not settings.database_url:
            warnings.append("DATABASE_URL unset — Postgres dual-write/primary disabled")
        if settings.use_postgres_primary and not settings.database_url:
            critical.append("USE_POSTGRES_PRIMARY=true requires DATABASE_URL")
        pub = (settings.public_base_url or "").strip()
        if not pub.startswith("https://"):
            # Render derives HTTPS from RENDER_EXTERNAL_URL; still warn if missing
            if not (os.environ.get("RENDER_EXTERNAL_URL") or "").startswith("https://"):
                warnings.append("PUBLIC_BASE_URL should be https:// in production (Twilio signature URL)")
    else:
        if not settings.openai_api_key:
            logger.info("OPENAI_API_KEY unset — AI heuristic mode")
        if not settings.stripe_secret_key and not settings.stripe_test_secret_key:
            logger.info("Stripe unset — payment mock mode")
    for w in warnings + critical:
        logger.warning("config: %s", w)
    if critical and settings.environment == "production":
        raise RuntimeError("; ".join(critical))
    return warnings + critical
