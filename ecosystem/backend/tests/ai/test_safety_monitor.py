from __future__ import annotations

import pytest

from app.ai.safety_monitor import SafetyAlertType, SafetyMonitor


@pytest.fixture
def safety() -> SafetyMonitor:
    return SafetyMonitor()


@pytest.mark.asyncio
async def test_route_deviation_alerts(safety: SafetyMonitor):
    alerts = await safety.evaluate(
        {
            "trip_id": "trip-1",
            "route_deviation": 0.45,
            "speed_kmh": 60,
            "unexpected_stop": False,
            "stop_duration_minutes": 0,
        }
    )
    types = {a.alert_type for a in alerts}
    assert SafetyAlertType.ROUTE_DEVIATION in types


@pytest.mark.asyncio
async def test_high_speed_alerts(safety: SafetyMonitor):
    alerts = await safety.evaluate(
        {
            "trip_id": "trip-1",
            "route_deviation": 0.05,
            "speed_kmh": 140,
            "unexpected_stop": False,
            "stop_duration_minutes": 0,
        }
    )
    types = {a.alert_type for a in alerts}
    assert SafetyAlertType.UNUSUAL_SPEED in types


@pytest.mark.asyncio
async def test_unexpected_stop_alerts(safety: SafetyMonitor):
    alerts = await safety.evaluate(
        {
            "trip_id": "trip-1",
            "route_deviation": 0.05,
            "speed_kmh": 0,
            "unexpected_stop": True,
            "stop_duration_minutes": 8,
        }
    )
    types = {a.alert_type for a in alerts}
    assert SafetyAlertType.UNEXPECTED_STOP in types


@pytest.mark.asyncio
async def test_clean_trip_no_alerts(safety: SafetyMonitor):
    alerts = await safety.evaluate(
        {
            "trip_id": "trip-1",
            "route_deviation": 0.05,
            "speed_kmh": 50,
            "unexpected_stop": False,
            "stop_duration_minutes": 0,
        }
    )
    assert alerts == []
