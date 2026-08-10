"""Webhook signature gate — Stripe fail-closed in production; Twilio when token set."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.config import Settings
from app.webhooks_security import verify_stripe_webhook


def test_stripe_dev_without_secret_accepts_stub():
    settings = Settings(
        environment="development",
        stripe_secret_key="",
        stripe_webhook_secret="",
    )
    event = verify_stripe_webhook(b"{}", "", settings=settings)
    assert event.get("dev_mode") is True


def test_stripe_production_requires_secret_when_enabled(monkeypatch):
    settings = Settings(
        environment="production",
        stripe_live_secret_key="sk_live_test",
        stripe_webhook_secret="",
        debug=False,
        jwt_secret="prod-secret-not-dev-default-xxxxxxxx",
        cors_origins="https://app.example.co.za",
    )
    import app.webhooks_security as wh

    class _Fake:
        enabled = True

        def construct_webhook_event(self, payload, sig):
            raise AssertionError("should not construct without secret")

    monkeypatch.setattr(wh, "get_stripe", lambda: _Fake())
    with pytest.raises(HTTPException) as ei:
        verify_stripe_webhook(b"{}", "t=1,v1=x", settings=settings)
    assert ei.value.status_code == 503


def test_stripe_missing_signature_400(monkeypatch):
    settings = Settings(
        environment="development",
        stripe_test_secret_key="sk_test_x",
        stripe_webhook_secret="whsec_x",
    )
    import app.webhooks_security as wh

    class _Fake:
        enabled = True

        def construct_webhook_event(self, payload, sig):
            raise ValueError("bad sig")

    monkeypatch.setattr(wh, "get_stripe", lambda: _Fake())
    with pytest.raises(HTTPException) as ei:
        verify_stripe_webhook(b"{}", "", settings=settings)
    assert ei.value.status_code == 400


def test_stripe_production_unconfigured_503():
    settings = Settings(
        environment="production",
        stripe_live_secret_key="",
        stripe_secret_key="",
        stripe_webhook_secret="",
        debug=False,
        jwt_secret="prod-secret-not-dev-default-xxxxxxxx",
        cors_origins="https://app.example.co.za",
        public_base_url="https://app.example.co.za",
    )
    with pytest.raises(HTTPException) as ei:
        verify_stripe_webhook(b"{}", "", settings=settings)
    assert ei.value.status_code == 503


@pytest.mark.asyncio
async def test_twilio_production_requires_token():
    from unittest.mock import MagicMock

    from app.webhooks_security import verify_twilio_request

    settings = Settings(
        environment="production",
        twilio_auth_token="",
        debug=False,
        jwt_secret="prod-secret-not-dev-default-xxxxxxxx",
        cors_origins="https://app.example.co.za",
        public_base_url="https://app.example.co.za",
    )
    req = MagicMock()
    req.body = MagicMock(return_value=b"Body=hi&From=%2B2782")
    # body is async
    async def _body():
        return b"Body=hi&From=%2B2782"

    req.body = _body
    with pytest.raises(HTTPException) as ei:
        await verify_twilio_request(req, settings=settings)
    assert ei.value.status_code == 503
