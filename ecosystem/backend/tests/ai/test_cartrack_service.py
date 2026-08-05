from __future__ import annotations

import base64

import httpx
import pytest

from app.cartrack_service import CartrackNotConfigured, CartrackService, CartrackUpstreamError
from app.config import Settings


def _settings(**overrides):
    values = {
        "cartrack_enabled": True,
        "cartrack_base_url": "https://fleetapi-za.cartrack.com/rest",
        "cartrack_username": "fleet-user",
        "cartrack_api_key": "test-key",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


async def test_list_vehicles_normalizes_status_and_uses_basic_auth():
    def handler(request: httpx.Request):
        expected = base64.b64encode(b"fleet-user:test-key").decode("ascii")
        assert request.url == "https://fleetapi-za.cartrack.com/rest/vehicles/status"
        assert request.headers["Authorization"] == f"Basic {expected}"
        return httpx.Response(
            200,
            json={
                "data": [
                    {
                        "vehicle_id": 42,
                        "registration_number": "CA 123-456",
                        "name": "My Ride 42",
                        "position": {
                            "latitude": -33.9249,
                            "longitude": 18.4241,
                            "speed": 38,
                            "heading": 92,
                            "timestamp": "2026-08-05T10:00:00Z",
                        },
                        "ignition": True,
                    }
                ]
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await CartrackService(_settings(), client).list_vehicles()

    assert result["provider"] == "cartrack"
    assert result["vehicles"] == [
        {
            "id": "42",
            "registration": "CA 123-456",
            "label": "My Ride 42",
            "lat": -33.9249,
            "lng": 18.4241,
            "heading": 92.0,
            "speed_kph": 38.0,
            "ignition": True,
            "updated_at": "2026-08-05T10:00:00Z",
        }
    ]


async def test_cartrack_requires_complete_configuration():
    service = CartrackService(_settings(cartrack_username=""))
    with pytest.raises(CartrackNotConfigured):
        await service.list_vehicles()


async def test_cartrack_sanitizes_upstream_errors():
    async def handler(_request: httpx.Request):
        return httpx.Response(401, json={"message": "credential rejected"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        service = CartrackService(_settings(), client)
        with pytest.raises(CartrackUpstreamError, match="telemetry is unavailable"):
            await service.list_vehicles()


@pytest.mark.parametrize(
    "base_url",
    [
        "http://fleetapi-za.cartrack.com/rest",
        "https://attacker.example/rest",
        "https://fleetapi-za.cartrack.com:8443/rest",
        "https://fleetapi-za.cartrack.com:invalid/rest",
        "https://user:pass@fleetapi-za.cartrack.com/rest",
    ],
)
async def test_cartrack_rejects_unapproved_base_urls_before_request(base_url):
    requested = False

    async def handler(_request: httpx.Request):
        nonlocal requested
        requested = True
        return httpx.Response(200, json=[])

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(CartrackNotConfigured):
            await CartrackService(_settings(cartrack_base_url=base_url), client).list_vehicles()

    assert requested is False


async def test_cartrack_normalizes_non_finite_numbers_and_string_ignition():
    async def handler(_request: httpx.Request):
        return httpx.Response(
            200,
            json={"data": [
                {"id": "invalid", "lat": "NaN", "lng": 18.4},
                {"id": "off", "lat": -33.9, "lng": 18.4, "speed": "Infinity", "heading": "NaN", "ignition": "false"},
                {"id": "on", "lat": -33.8, "lng": 18.5, "ignition": "1"},
            ]},
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        vehicles = (await CartrackService(_settings(), client).list_vehicles())["vehicles"]

    assert [vehicle["id"] for vehicle in vehicles] == ["off", "on"]
    assert vehicles[0]["speed_kph"] == 0.0
    assert vehicles[0]["heading"] == 0.0
    assert vehicles[0]["ignition"] is False
    assert vehicles[1]["ignition"] is True


async def test_cartrack_does_not_close_an_injected_client():
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda _request: httpx.Response(200, json=[])))
    service = CartrackService(_settings(), client)

    await service.close()

    assert client.is_closed is False
    await client.aclose()