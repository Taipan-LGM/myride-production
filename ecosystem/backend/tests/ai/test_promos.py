"""Promo / referral tests."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.asyncio
async def test_redeem_promo():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        login = await client.post(
            "/auth/login",
            json={"identifier": "rider@myride.co.za", "password": "ride123", "role": "rider"},
        )
        token = login.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        r = await client.post("/promos/redeem", headers=headers, json={"code": "MYRIDE50"})
        assert r.status_code == 200
        assert r.json()["credited_cents"] == 5000
        # Second redeem fails
        r2 = await client.post("/promos/redeem", headers=headers, json={"code": "MYRIDE50"})
        assert r2.status_code == 400


@pytest.mark.asyncio
async def test_referral_me():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        login = await client.post(
            "/auth/login",
            json={"identifier": "rider@myride.co.za", "password": "ride123", "role": "rider"},
        )
        token = login.json()["access_token"]
        r = await client.get(
            "/referrals/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200
        assert "referral_code" in r.json()
