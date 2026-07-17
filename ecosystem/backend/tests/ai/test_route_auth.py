from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


def _login(client: TestClient, email: str, password: str, role: str) -> str:
    res = client.post(
        "/auth/login",
        json={"identifier": email, "password": password, "role": role},
    )
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


def test_payments_and_mutations_require_auth():
    with TestClient(app) as client:
        assert client.get("/payments/ledger").status_code == 401
        assert client.post(
            "/driver/update-availability",
            json={"driver_id": "driver-demo-001", "is_online": True},
        ).status_code == 401
        assert client.post(
            "/create-payment-intent",
            json={"amount_cents": 1000, "rider_id": "rider-demo-001"},
        ).status_code == 401

        rider = _login(client, "rider@myride.co.za", "ride123", "rider")
        driver = _login(client, "driver@myride.co.za", "drive123", "driver")
        admin = _login(client, "admin@myride.co.za", "admin123", "admin")

        # Rider cannot open ledger
        assert (
            client.get(
                "/payments/ledger",
                headers={"Authorization": f"Bearer {rider}"},
            ).status_code
            == 403
        )
        # Admin can
        assert (
            client.get(
                "/payments/ledger",
                headers={"Authorization": f"Bearer {admin}"},
            ).status_code
            == 200
        )

        # Driver availability self-only
        ok = client.post(
            "/driver/update-availability",
            headers={"Authorization": f"Bearer {driver}"},
            json={
                "driver_id": "driver-demo-001",
                "is_online": True,
                "location": {"lat": -33.92, "lng": 18.42},
            },
        )
        assert ok.status_code == 200, ok.text

        forbidden = client.post(
            "/driver/update-availability",
            headers={"Authorization": f"Bearer {driver}"},
            json={
                "driver_id": "someone-else",
                "is_online": True,
                "location": {"lat": -33.92, "lng": 18.42},
            },
        )
        assert forbidden.status_code == 403
