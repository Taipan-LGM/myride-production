from __future__ import annotations

from fastapi.testclient import TestClient

from app.cartrack_service import CartrackUpstreamError, get_cartrack
from app.main import app


def _login(client: TestClient, role: str) -> str:
    credentials = {
        "rider": ("rider@myride.co.za", "ride123"),
        "admin": ("admin@myride.co.za", "admin123"),
    }
    identifier, password = credentials[role]
    response = client.post(
        "/auth/login",
        json={"identifier": identifier, "password": password, "role": role},
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def test_cartrack_fleet_route_requires_admin():
    with TestClient(app) as client:
        assert client.get("/admin/fleet/vehicles").status_code == 401
        rider_token = _login(client, "rider")
        response = client.get(
            "/admin/fleet/vehicles",
            headers={"Authorization": f"Bearer {rider_token}"},
        )
        assert response.status_code == 403


def test_cartrack_fleet_route_returns_normalized_vehicles():
    class FakeCartrack:
        async def list_vehicles(self):
            return {
                "provider": "cartrack",
                "fetched_at": "2026-08-05T10:00:00Z",
                "vehicles": [{"id": "42", "registration": "CA 123-456", "lat": -33.92, "lng": 18.42}],
            }

    app.dependency_overrides[get_cartrack] = lambda: FakeCartrack()
    try:
        with TestClient(app) as client:
            admin_token = _login(client, "admin")
            response = client.get(
                "/admin/fleet/vehicles",
                headers={"Authorization": f"Bearer {admin_token}"},
            )
            assert response.status_code == 200
            assert response.json()["vehicles"][0]["registration"] == "CA 123-456"
    finally:
        app.dependency_overrides.pop(get_cartrack, None)


def test_cartrack_fleet_route_sanitizes_upstream_failure():
    class FailingCartrack:
        async def list_vehicles(self):
            raise CartrackUpstreamError("Cartrack fleet telemetry is unavailable")

    app.dependency_overrides[get_cartrack] = lambda: FailingCartrack()
    try:
        with TestClient(app) as client:
            admin_token = _login(client, "admin")
            response = client.get(
                "/admin/fleet/vehicles",
                headers={"Authorization": f"Bearer {admin_token}"},
            )
            assert response.status_code == 502
            assert response.json() == {"detail": "Cartrack fleet telemetry is unavailable"}
    finally:
        app.dependency_overrides.pop(get_cartrack, None)