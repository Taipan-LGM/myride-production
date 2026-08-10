"""Hub and health must remain reachable under burst traffic."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


def test_hub_survives_burst():
    with TestClient(app) as client:
        for _ in range(50):
            client.get("/docs")
        assert client.get("/health").status_code == 200
        assert client.get("/").status_code == 200
