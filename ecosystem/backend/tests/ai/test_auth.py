from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    return TestClient(app)


def test_login_rider(client: TestClient):
    res = client.post(
        "/auth/login",
        json={"identifier": "rider@myride.co.za", "password": "ride123", "role": "rider"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["user"]["role"] == "rider"
    assert data["access_token"]


def test_login_wrong_role(client: TestClient):
    res = client.post(
        "/auth/login",
        json={"identifier": "rider@myride.co.za", "password": "ride123", "role": "admin"},
    )
    assert res.status_code == 403


def test_admin_metrics_requires_auth(client: TestClient):
    assert client.get("/admin/metrics").status_code == 401
    login = client.post(
        "/auth/login",
        json={"identifier": "admin@myride.co.za", "password": "admin123", "role": "admin"},
    )
    token = login.json()["access_token"]
    res = client.get("/admin/metrics", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json()["currency"] == "ZAR"


def test_hub_serves_branded_html(client: TestClient):
    res = client.get("/")
    assert res.status_code == 200
    assert b"My Ride" in res.content
    assert b"login-screen" in res.content
