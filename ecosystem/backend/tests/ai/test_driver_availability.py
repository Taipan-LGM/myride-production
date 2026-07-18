"""Driver availability must work even when demo seed is missing (cold store)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.firestore_db import FirestoreDB, _memory
from app.main import app


def test_driver_availability_creates_profile_without_seed():
    with TestClient(app) as client:
        # Wipe in-memory drivers to simulate Render cold/ephemeral store miss
        _memory["drivers"].clear()

        login = client.post(
            "/auth/login",
            json={
                "identifier": "driver@myride.co.za",
                "password": "drive123",
                "role": "driver",
            },
        )
        assert login.status_code == 200, login.text
        token = login.json()["access_token"]

        res = client.post(
            "/driver/update-availability",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "driver_id": "driver-demo-001",
                "is_online": True,
                "location": {"lat": -33.925, "lng": 18.425},
            },
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["id"] == "driver-demo-001"
        assert body["is_online"] is True
        assert body.get("phone")


def test_create_driver_allows_missing_phone():
    import asyncio

    async def _run() -> None:
        db = FirestoreDB()
        driver = await db.create_driver(
            {
                "id": "driver-tmp-phone",
                "name": "Temp",
                "location": {"lat": -26.2, "lng": 28.0},
                "is_online": True,
            }
        )
        assert driver.id == "driver-tmp-phone"
        assert driver.phone is None

    asyncio.run(_run())
