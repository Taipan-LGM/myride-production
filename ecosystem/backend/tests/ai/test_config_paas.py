"""Paas / Render URL derivation for production CORS."""

from __future__ import annotations

import os

import pytest

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


def test_production_cannot_disable_demos_without_firebase():
    settings = Settings(
        _env_file=None,
        environment="production",
        jwt_secret="prod-secret-not-dev-default-xxxxxxxx",
        cors_origins="https://myride.example",
        public_base_url="https://myride.example",
        allow_demo_accounts=False,
        firestore_project_id="",
    )
    with pytest.raises(RuntimeError, match="FIRESTORE_PROJECT_ID"):
        validate_settings(settings)


def test_production_can_disable_demos_with_firebase():
    settings = Settings(
        _env_file=None,
        environment="production",
        jwt_secret="prod-secret-not-dev-default-xxxxxxxx",
        cors_origins="https://myride.example",
        public_base_url="https://myride.example",
        allow_demo_accounts=False,
        firestore_project_id="myride-production",
    )
    validate_settings(settings)
