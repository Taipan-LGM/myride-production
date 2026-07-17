from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


def test_channels_directory_and_simulate():
    with TestClient(app) as client:
        directory = client.get("/channels")
        assert directory.status_code == 200
        body = directory.json()
        assert "app" in body and "website" in body
        assert "phone" in body and "whatsapp" in body

        login = client.post(
            "/auth/login",
            json={
                "identifier": "rider@myride.co.za",
                "password": "ride123",
                "role": "rider",
            },
        )
        token = login.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        voice = client.post(
            "/channels/voice/simulate",
            headers=headers,
            json={
                "text": "Book a ride from Cape Town CBD to the Waterfront",
                "from_number": "+27821234567",
            },
        )
        assert voice.status_code == 200, voice.text
        assert voice.json()["channel"] == "voice"

        wa = client.post(
            "/channels/whatsapp/simulate",
            headers=headers,
            json={
                "text": "Hi book me from Sandton to OR Tambo",
                "from_number": "+27821234567",
            },
        )
        assert wa.status_code == 200, wa.text
        assert wa.json()["channel"] == "whatsapp"
