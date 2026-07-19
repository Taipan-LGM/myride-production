"""Phase 0 bulk seed (admin)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


def _admin_token(client: TestClient) -> str:
    r = client.post(
        "/auth/login",
        json={"identifier": "admin@myride.co.za", "password": "admin123", "role": "admin"},
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def test_phase0_bootstrap_small():
    with TestClient(app) as client:
        tok = _admin_token(client)
        r = client.post(
            "/admin/phase0/bootstrap?drivers=5&rides=12",
            headers={"Authorization": f"Bearer {tok}"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["drivers"]["drivers"] == 5
        assert body["rides"]["rides_completed"] == 12


def test_phase0_requires_admin():
    with TestClient(app) as client:
        r = client.post("/admin/phase0/bootstrap?drivers=2&rides=2")
        assert r.status_code == 401
