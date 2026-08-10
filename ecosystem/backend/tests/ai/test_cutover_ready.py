"""Cutover readiness + demo account gate."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


def test_cutover_endpoint_shape():
    with TestClient(app) as client:
        r = client.get("/ops/cutover")
        assert r.status_code == 200, r.text
        body = r.json()
        assert "ready_for_public" in body
        assert "webhook_urls" in body
        assert body["webhook_urls"]["stripe"].endswith("/webhooks/stripe")
        assert isinstance(body["missing"], list)


def test_demo_login_blocked_when_disabled(monkeypatch):
    from app.config import get_settings

    monkeypatch.setenv("ALLOW_DEMO_ACCOUNTS", "false")
    get_settings.cache_clear()
    try:
        with TestClient(app) as client:
            r = client.post(
                "/auth/login",
                json={
                    "identifier": "rider@myride.co.za",
                    "password": "ride123",
                    "role": "rider",
                },
            )
            assert r.status_code == 403, r.text
    finally:
        monkeypatch.delenv("ALLOW_DEMO_ACCOUNTS", raising=False)
        get_settings.cache_clear()
