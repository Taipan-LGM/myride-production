from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.auth import authenticate_firebase, create_token, decode_token
from app.config import Settings
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


def test_firebase_phone_user_defaults_to_rider():
    user = authenticate_firebase(
        "verified-token",
        requested_role="rider",
        settings=Settings(firestore_project_id="myride-test"),
        verifier=lambda _token, _settings: {
            "sub": "firebase-rider-1",
            "phone_number": "+27821234567",
        },
    )
    assert user.id == "firebase-rider-1"
    assert user.role == "rider"
    assert user.phone == "+27821234567"
    assert decode_token(create_token(user), Settings()).email is None


def test_firebase_unclaimed_user_cannot_elevate_to_driver():
    with pytest.raises(Exception) as exc_info:
        authenticate_firebase(
            "verified-token",
            requested_role="driver",
            settings=Settings(firestore_project_id="myride-test"),
            verifier=lambda _token, _settings: {"sub": "firebase-user-1"},
        )
    assert getattr(exc_info.value, "status_code", None) == 403


def test_firebase_driver_requires_matching_role_claim():
    user = authenticate_firebase(
        "verified-token",
        requested_role="driver",
        settings=Settings(firestore_project_id="myride-test"),
        verifier=lambda _token, _settings: {
            "sub": "firebase-driver-1",
            "role": "driver",
            "email": "approved.driver@example.com",
        },
    )
    assert user.role == "driver"


def test_firebase_exchange_endpoint(monkeypatch: pytest.MonkeyPatch, client: TestClient):
    monkeypatch.setattr(
        "app.main.authenticate_firebase",
        lambda _token, requested_role=None: authenticate_firebase(
            "verified-token",
            requested_role=requested_role,
            settings=Settings(firestore_project_id="myride-test"),
            verifier=lambda _value, _settings: {"sub": "firebase-rider-2"},
        ),
    )
    res = client.post(
        "/auth/firebase",
        json={"id_token": "a-valid-length-firebase-token", "role": "rider"},
    )
    assert res.status_code == 200
    assert res.json()["user"]["id"] == "firebase-rider-2"
    assert res.json()["access_token"]


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
