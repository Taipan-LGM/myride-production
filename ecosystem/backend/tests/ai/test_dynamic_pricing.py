from __future__ import annotations

import pytest

from app.ai.dynamic_pricing import DynamicPricingEngine


@pytest.fixture
def pricing() -> DynamicPricingEngine:
    return DynamicPricingEngine()


@pytest.mark.asyncio
async def test_minimum_fare_zar(pricing: DynamicPricingEngine):
    fare = await pricing.calculate_fare(
        pickup_lat=-33.9249,
        pickup_lng=18.4241,
        dropoff_lat=-33.9250,
        dropoff_lng=18.4242,
        distance_km=0.1,
        duration_minutes=1,
    )
    assert fare.currency == "ZAR"
    assert fare.total >= DynamicPricingEngine.MINIMUM_FARE


@pytest.mark.asyncio
async def test_breakdown_fields_present(pricing: DynamicPricingEngine):
    fare = await pricing.calculate_fare(
        pickup_lat=-33.9249,
        pickup_lng=18.4241,
        dropoff_lat=-33.9100,
        dropoff_lng=18.4100,
        distance_km=5.0,
        duration_minutes=15,
    )
    assert fare.base_fare == DynamicPricingEngine.BASE_FARE
    assert fare.distance_km == 5.0
    assert fare.duration_minutes == 15
    assert fare.surge_multiplier >= 1.0
    assert fare.platform_fee >= 0
    assert fare.total > 0


@pytest.mark.asyncio
async def test_surge_clamped(pricing: DynamicPricingEngine):
    pricing.set_zone_metrics("zone_-33.92_18.42", demand=100, supply=1)
    fare = await pricing.calculate_fare(
        pickup_lat=-33.9249,
        pickup_lng=18.4241,
        dropoff_lat=-33.9100,
        dropoff_lng=18.4100,
        distance_km=5.0,
        duration_minutes=15,
    )
    assert DynamicPricingEngine.MIN_SURGE <= fare.surge_multiplier <= DynamicPricingEngine.MAX_SURGE


@pytest.mark.asyncio
async def test_loyalty_discount(pricing: DynamicPricingEngine):
    base = await pricing.calculate_fare(
        pickup_lat=-33.9249,
        pickup_lng=18.4241,
        dropoff_lat=-33.9100,
        dropoff_lng=18.4100,
        distance_km=8.0,
        duration_minutes=20,
        loyalty_tier="bronze",
    )
    gold = await pricing.calculate_fare(
        pickup_lat=-33.9249,
        pickup_lng=18.4241,
        dropoff_lat=-33.9100,
        dropoff_lng=18.4100,
        distance_km=8.0,
        duration_minutes=20,
        loyalty_tier="gold",
    )
    assert gold.discount_applied > base.discount_applied
    assert gold.total <= base.total
