from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


def _token(client: TestClient, email: str, password: str, role: str) -> str:
    res = client.post(
        "/auth/login",
        json={"identifier": email, "password": password, "role": role},
    )
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


def test_book_requires_auth():
    with TestClient(app) as client:
        bare = client.post(
            "/ai/book",
            json={
                "rider_id": "x",
                "pickup": {"lat": -33.92, "lng": 18.42},
                "dropoff": {"lat": -33.91, "lng": 18.41},
            },
        )
        assert bare.status_code == 401
        token = _token(client, "rider@myride.co.za", "ride123", "rider")
        ok = client.post(
            "/ai/book",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "rider_id": "rider-demo-001",
                "pickup": {"lat": -33.9249, "lng": 18.4241},
                "dropoff": {"lat": -33.9180, "lng": 18.4232},
            },
        )
        assert ok.status_code == 200, ok.text
        assert ok.json().get("currency") == "ZAR"


def test_suggestions_history_insights():
    with TestClient(app) as client:
        token = _token(client, "rider@myride.co.za", "ride123", "rider")
        headers = {"Authorization": f"Bearer {token}"}
        sug = client.get("/ai/suggestions", headers=headers)
        assert sug.status_code == 200
        assert len(sug.json()["suggestions"]) >= 1
        hist = client.get("/rides/history", headers=headers)
        assert hist.status_code == 200
        assert "trips" in hist.json()
        dtoken = _token(client, "driver@myride.co.za", "drive123", "driver")
        insights = client.get(
            "/ai/driver-insights/driver-demo-001",
            headers={"Authorization": f"Bearer {dtoken}"},
        )
        assert insights.status_code == 200
        assert "headline" in insights.json()
