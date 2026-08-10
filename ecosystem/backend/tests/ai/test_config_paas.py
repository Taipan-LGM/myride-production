"""Paas / Render URL derivation for production CORS."""

from __future__ import annotations

import os

from app.config import Settings
from app.startup_checks import validate_settings


def test_render_external_url_derives_cors_and_public_base(monkeypatch):
    monkeypatch.setenv("RENDER_EXTERNAL_URL", "https://my-ride-ecosystem.onrender.com")
    s = Settings(
        _env_file=None,
        environment="production",
        debug=False,
        jwt_secret="prod-secret-not-dev-default-xxxxxxxx",
        cors_origins="*",
        public_base_url="http://localhost:8000",
    )
    assert s.public_base_url == "https://my-ride-ecosystem.onrender.com"
    assert s.cors_origins == "https://my-ride-ecosystem.onrender.com"
    # Should not raise (Stripe/Twilio/DB are warnings only)
    validate_settings(s)


def test_dev_does_not_override_cors(monkeypatch):
    monkeypatch.setenv("RENDER_EXTERNAL_URL", "https://my-ride-ecosystem.onrender.com")
    s = Settings(
        _env_file=None,
        environment="development",
        cors_origins="*",
        public_base_url="http://localhost:8000",
    )
    assert s.cors_origins == "*"
    assert s.public_base_url == "http://localhost:8000"
