from __future__ import annotations

from fastapi.testclient import TestClient

from app.firestore_db import _memory
from app.main import app
import app.postgres_db as postgres_db
from app.stripe_service import get_stripe


class FakeStripeConnect:
    enabled = True

    def __init__(self) -> None:
        self.accounts_created = 0
        self.links_created = 0

    async def create_connect_account(self, driver_id: str, email: str) -> dict:
        self.accounts_created += 1
        return {"id": "acct_driver_test", "dev_mode": False}

    async def create_connect_account_link(self, account_id: str) -> dict:
        self.links_created += 1
        return {"url": f"https://connect.stripe.test/{self.links_created}", "expires_at": 123}

    async def create_connect_login_link(self, account_id: str) -> dict:
        return {"url": "https://connect.stripe.test/dashboard"}

    async def get_connect_account_status(self, account_id: str) -> dict:
        return {
            "details_submitted": False,
            "payouts_enabled": False,
            "charges_enabled": False,
            "dev_mode": False,
        }


def _login(client: TestClient, role: str) -> str:
    credentials = {
        "driver": ("driver@myride.co.za", "drive123"),
        "rider": ("rider@myride.co.za", "ride123"),
    }
    email, password = credentials[role]
    response = client.post("/auth/login", json={"identifier": email, "password": password, "role": role})
    return response.json()["access_token"]


def test_driver_stripe_connect_reuses_persisted_account():
    fake = FakeStripeConnect()
    fake.connect_available = True
    app.dependency_overrides[get_stripe] = lambda: fake
    original_account = _memory["drivers"].get("driver-demo-001", {}).get("stripe_account_id")
    try:
        with TestClient(app) as client:
            driver_token = _login(client, "driver")
            rider_token = _login(client, "rider")
            headers = {"Authorization": f"Bearer {driver_token}"}
            _memory["drivers"]["driver-demo-001"].pop("stripe_account_id", None)

            first = client.post("/drivers/me/stripe-connect/onboarding", headers=headers)
            second = client.post("/drivers/me/stripe-connect/onboarding", headers=headers)
            status = client.get("/drivers/me/stripe-connect", headers=headers)
            forbidden = client.get(
                "/drivers/me/stripe-connect",
                headers={"Authorization": f"Bearer {rider_token}"},
            )

            assert first.status_code == 200
            assert second.status_code == 200
            assert first.json()["account_id"] == "acct_driver_test"
            assert second.json()["onboarding_url"].endswith("/2")
            assert status.json()["status"] == "pending"
            assert _memory["drivers"]["driver-demo-001"]["stripe_account_id"] == "acct_driver_test"
            assert fake.accounts_created == 1
            assert fake.links_created == 2
            assert forbidden.status_code == 403
    finally:
        if original_account is None:
            _memory["drivers"].get("driver-demo-001", {}).pop("stripe_account_id", None)
        else:
            _memory["drivers"]["driver-demo-001"]["stripe_account_id"] = original_account
        app.dependency_overrides.pop(get_stripe, None)


async def test_driver_profile_restores_persisted_payout_account(monkeypatch):
    from app.firestore_db import FirestoreDB

    async def stored_setting(key: str):
        assert key == "driver_payout:driver-demo-001"
        return {"stripe_account_id": "acct_persisted"}

    monkeypatch.setattr(postgres_db, "get_platform_setting", stored_setting)
    _memory["drivers"]["driver-demo-001"].pop("stripe_account_id", None)
    try:
        profile = await FirestoreDB().get_driver("driver-demo-001")
        assert profile is not None
        assert profile.stripe_account_id == "acct_persisted"
    finally:
        _memory["drivers"]["driver-demo-001"].pop("stripe_account_id", None)