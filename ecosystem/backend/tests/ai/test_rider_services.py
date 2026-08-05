"""Tests for wallet, loyalty, carbon, safety SOS."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.rider_services import (
    award_loyalty_for_trip,
    carbon_for_distance_km,
    charge_wallet,
    get_loyalty,
    get_wallet,
    save_place,
    top_up_wallet,
)
from app.safety_ops import EMERGENCY_NUMBER, create_share_link, get_share


@pytest.mark.asyncio
async def test_emergency_public():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/safety/emergency")
        assert r.status_code == 200
        assert r.json()["emergency_number"] == "112"


@pytest.mark.asyncio
async def test_wallet_loyalty_places_flow():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        login = await client.post(
            "/auth/login",
            json={"identifier": "rider@myride.co.za", "password": "ride123", "role": "rider"},
        )
        assert login.status_code == 200
        token = login.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        w = await client.get("/wallet", headers=headers)
        assert w.status_code == 200
        assert w.json()["balance_cents"] >= 0

        top = await client.post("/wallet/top-up", headers=headers, json={"amount_cents": 5000})
        assert top.status_code == 200
        assert top.json()["balance_cents"] >= 5000

        loy = await client.get("/loyalty", headers=headers)
        assert loy.status_code == 200
        assert "tier" in loy.json()

        place = await client.post(
            "/places",
            headers=headers,
            json={"kind": "home", "label": "Home", "lat": -33.92, "lng": 18.42},
        )
        assert place.status_code == 200
        assert place.json()["place"]["kind"] == "home"

        carbon = await client.post("/carbon/estimate", json={"distance_km": 10})
        assert carbon.status_code == 200
        assert carbon.json()["co2_kg"] == pytest.approx(1.8)


@pytest.mark.asyncio
async def test_sos_and_share():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        login = await client.post(
            "/auth/login",
            json={"identifier": "rider@myride.co.za", "password": "ride123", "role": "rider"},
        )
        token = login.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        sos = await client.post(
            "/safety/sos",
            headers=headers,
            json={"note": "test", "lat": -33.92, "lng": 18.42},
        )
        assert sos.status_code == 200
        body = sos.json()
        assert body["emergency_number"] == EMERGENCY_NUMBER
        assert body["dial"] == "tel:112"


def test_carbon_unit():
    c = carbon_for_distance_km(5)
    assert c["co2_kg"] == pytest.approx(0.9)
    assert c["co2_g"] == 900


def test_wallet_charge_and_loyalty():
    uid = "unit-rider-wallet"
    top_up_wallet(uid, 10_000)
    w = charge_wallet(uid, 2500)
    assert w["balance_cents"] == get_wallet(uid)["balance_cents"]
    loy = award_loyalty_for_trip(uid, 8500)
    assert loy["earned_this_trip"] == 85
    assert get_loyalty(uid)["points"] >= 85

    place = save_place(uid, {"kind": "work", "label": "Office", "lat": -26.1, "lng": 28.0})
    assert place["kind"] == "work"

    link = create_share_link("trip-x", uid, ttl_seconds=60)
    assert get_share(link["token"])["trip_id"] == "trip-x"


@pytest.mark.asyncio
async def test_fare_estimate_includes_carbon():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.post(
            "/fare-estimate",
            json={
                "pickup": {"lat": -33.9249, "lng": 18.4241},
                "dropoff": {"lat": -33.9180, "lng": 18.4232},
                "vehicle_type": "standard",
            },
        )
        assert r.status_code == 200
        assert r.json()["currency"] == "zar"
        data = r.json()
        assert "carbon" in data
        assert data["carbon"]["co2_kg"] >= 0


@pytest.mark.asyncio
async def test_driver_earnings_auth():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        login = await client.post(
            "/auth/login",
            json={"identifier": "driver@myride.co.za", "password": "drive123", "role": "driver"},
        )
        token = login.json()["access_token"]
        r = await client.get(
            "/driver/earnings",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200


@pytest.mark.asyncio
async def test_driver_earnings_use_persisted_mixed_policy_snapshots():
    from app.firestore_db import FirestoreDB

    db = FirestoreDB()
    await db.connect()
    driver_id = "driver-durable-earnings"
    common = {
        "rider_id": "rider-durable-earnings",
        "driver_id": driver_id,
        "pickup": {"lat": -33.92, "lng": 18.42},
        "dropoff": {"lat": -33.91, "lng": 18.41},
        "status": "completed",
        "reconciliation_status": "reconciled",
        "reconciled_at": "2026-08-05T10:00:00+00:00",
    }
    await db.create_trip({
        **common,
        "id": "trip-durable-80",
        "fare_final_cents": 10000,
        "driver_share_bps": 8000,
        "driver_payout_cents": 8000,
        "platform_fee_cents": 2000,
    })
    await db.create_trip({
        **common,
        "id": "trip-durable-85",
        "fare_final_cents": 20000,
        "driver_share_bps": 8500,
        "driver_payout_cents": 17000,
        "platform_fee_cents": 3000,
    })

    summary = await db.driver_earnings_summary(driver_id)

    assert summary["trips"] == 2
    assert summary["total_cents"] == 25000
    assert summary["gross_fare_cents"] == 30000
    assert summary["platform_fee_cents"] == 5000
    assert summary["driver_share_percent"] is None
    assert summary["policy_breakdown"] == [
        {"driver_share_bps": 8000, "driver_share_percent": 80.0, "trips": 1},
        {"driver_share_bps": 8500, "driver_share_percent": 85.0, "trips": 1},
    ]
