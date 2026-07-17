from __future__ import annotations

import pytest

from app.ai.smart_router import RideContext, SmartRouter
from app.models import DriverProfile, GeoPoint


def _driver(
    driver_id: str,
    lat: float,
    lng: float,
    *,
    name: str = "Driver",
    rating: float = 5.0,
    vehicle_type: str = "standard",
    acceptance_rate: float = 95.0,
    safety_score: float = 90.0,
) -> DriverProfile:
    return DriverProfile(
        id=driver_id,
        name=name,
        phone="+27000000000",
        location=GeoPoint(lat=lat, lng=lng),
        is_online=True,
        rating=rating,
        vehicle_make=vehicle_type,
        vehicle_model="Test",
    )


@pytest.fixture
def router() -> SmartRouter:
    return SmartRouter()


@pytest.fixture
def cape_town_pickup() -> RideContext:
    return RideContext(
        pickup=GeoPoint(lat=-33.9249, lng=18.4241),
        dropoff=GeoPoint(lat=-33.9180, lng=18.4232),
        vehicle_type="standard",
        passenger_rating=5.0,
    )


@pytest.mark.asyncio
async def test_empty_pool_returns_empty(router: SmartRouter, cape_town_pickup: RideContext):
    scores = await router.find_best_drivers(cape_town_pickup, drivers=[])
    assert scores == []


@pytest.mark.asyncio
async def test_closer_driver_ranks_higher(router: SmartRouter, cape_town_pickup: RideContext):
    near = _driver("near", -33.9250, 18.4242, name="Near", rating=4.5)
    far = _driver("far", -33.9500, 18.4500, name="Far", rating=5.0)
    scores = await router.find_best_drivers(cape_town_pickup, drivers=[far, near], top_n=2)
    assert len(scores) == 2
    assert scores[0].driver_id == "near"
    assert scores[0].score >= scores[1].score


@pytest.mark.asyncio
async def test_higher_rated_beats_equal_distance(router: SmartRouter, cape_town_pickup: RideContext):
    low = _driver("low", -33.9250, 18.4242, rating=3.5, name="Low")
    high = _driver("high", -33.9250, 18.4242, rating=5.0, name="High")
    scores = await router.find_best_drivers(cape_town_pickup, drivers=[low, high], top_n=2)
    assert scores[0].driver_id == "high"


@pytest.mark.asyncio
async def test_vehicle_mismatch_lowers_score(router: SmartRouter, cape_town_pickup: RideContext):
    matching = _driver("match", -33.9250, 18.4242, vehicle_type="standard")
    mismatch = _driver("miss", -33.9250, 18.4242, vehicle_type="luxury")
    ctx = RideContext(
        pickup=cape_town_pickup.pickup,
        dropoff=cape_town_pickup.dropoff,
        vehicle_type="standard",
    )
    scores = await router.find_best_drivers(ctx, drivers=[mismatch, matching], top_n=2)
    by_id = {s.driver_id: s for s in scores}
    assert by_id["match"].score > by_id["miss"].score
