from __future__ import annotations

import pytest

from app.ai_dispatcher import AiDispatcher
from app.models import DriverProfile, GeoPoint


@pytest.fixture
def dispatcher() -> AiDispatcher:
    return AiDispatcher()


@pytest.mark.asyncio
async def test_process_booking_uses_router_and_pricing(dispatcher: AiDispatcher):
    drivers = [
        DriverProfile(
            id="d1",
            name="Alice",
            phone="+27111111111",
            location=GeoPoint(lat=-33.9250, lng=18.4242),
            is_online=True,
            rating=4.9,
            vehicle_make="standard",
        ),
        DriverProfile(
            id="d2",
            name="Bob",
            phone="+27222222222",
            location=GeoPoint(lat=-33.9400, lng=18.4400),
            is_online=True,
            rating=4.2,
            vehicle_make="standard",
        ),
    ]
    offer = await dispatcher.process_booking(
        rider_id="rider-1",
        pickup=GeoPoint(lat=-33.9249, lng=18.4241),
        dropoff=GeoPoint(lat=-33.9180, lng=18.4232),
        vehicle_type="standard",
        drivers=drivers,
    )
    assert offer["status"] in ("searching", "drivers_found", "blocked")
    assert "fare" in offer
    assert offer["fare"]["currency"] == "ZAR"
    assert "drivers" in offer
    if offer["status"] != "blocked":
        assert len(offer["drivers"]) >= 1
        assert offer["drivers"][0]["driver_id"] == "d1"


@pytest.mark.asyncio
async def test_handle_support_delegates_to_cs(dispatcher: AiDispatcher):
    result = await dispatcher.handle_support(
        user_id="rider-1",
        query="I lost my phone in the car",
        context={"trip_id": "trip-9", "driver_id": "d1", "status": "completed"},
    )
    assert "message" in result
    assert "action" in result
    assert "category" in result
    assert result["category"] == "lost_item"
