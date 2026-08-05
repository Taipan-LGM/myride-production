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


def test_driver_cannot_complete_unassigned_trip():
    with TestClient(app) as client:
        rider = _login(client, "rider@myride.co.za", "ride123", "rider")
        driver = _login(client, "driver@myride.co.za", "drive123", "driver")

        requested = client.post(
            "/request-ride",
            headers={"Authorization": f"Bearer {rider}"},
            json={
                "rider_id": "rider-demo-001",
                "pickup": {"lat": -33.9249, "lng": 18.4241},
                "dropoff": {"lat": -33.9068, "lng": 18.4198},
                "fare_estimate_cents": 12000,
            },
        )
        assert requested.status_code == 200, requested.text

        completed = client.post(
            f"/complete-ride/{requested.json()['id']}",
            headers={"Authorization": f"Bearer {driver}"},
        )

        assert completed.status_code == 403
        assert completed.json()["detail"] == "Not assigned to this trip"

        accepted = client.post(
            f"/accept-ride/{requested.json()['id']}",
            headers={"Authorization": f"Bearer {driver}"},
            json={"driver_id": "driver-demo-001"},
        )
        assert accepted.status_code == 200, accepted.text

        accepted_again = client.post(
            f"/accept-ride/{requested.json()['id']}",
            headers={"Authorization": f"Bearer {driver}"},
            json={"driver_id": "driver-demo-001"},
        )
        assert accepted_again.status_code == 409
        assert accepted_again.json()["detail"] == "Trip is no longer available"
