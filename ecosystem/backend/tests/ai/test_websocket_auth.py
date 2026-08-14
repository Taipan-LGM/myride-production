from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import app


def _login(client: TestClient, email: str, password: str, role: str) -> str:
    response = client.post(
        "/auth/login",
        json={"identifier": email, "password": password, "role": role},
    )
    assert response.status_code == 200
    return response.json()["access_token"]


def test_driver_stream_requires_authentication():
    with TestClient(app) as client:
        with pytest.raises(WebSocketDisconnect) as exc_info:
            with client.websocket_connect("/ws/driver-requests/driver-demo-001") as websocket:
                websocket.send_json({"type": "ping"})
                websocket.receive_json()
        assert exc_info.value.code == 4401


def test_driver_cannot_subscribe_to_another_driver_stream():
    with TestClient(app) as client:
        token = _login(client, "driver@myride.co.za", "drive123", "driver")
        with pytest.raises(WebSocketDisconnect) as exc_info:
            with client.websocket_connect("/ws/driver-requests/someone-else") as websocket:
                websocket.send_json({"type": "auth", "token": token})
                websocket.receive_json()
        assert exc_info.value.code == 4403


def test_driver_can_subscribe_to_own_stream():
    with TestClient(app) as client:
        token = _login(client, "driver@myride.co.za", "drive123", "driver")
        with client.websocket_connect("/ws/driver-requests/driver-demo-001") as websocket:
            websocket.send_json({"type": "auth", "token": token})
            assert websocket.receive_json()["event"] == "connected"


def test_rider_can_subscribe_to_own_trip_only():
    with TestClient(app) as client:
        rider = _login(client, "rider@myride.co.za", "ride123", "rider")
        with client.websocket_connect("/ws/trips/trip-demo-001") as websocket:
            websocket.send_json({"type": "auth", "token": rider})
            assert websocket.receive_json()["type"] == "connected"

        with pytest.raises(WebSocketDisconnect) as exc_info:
            with client.websocket_connect("/ws/trips/trip-driver-001") as websocket:
                websocket.send_json({"type": "auth", "token": rider})
                websocket.receive_json()
        assert exc_info.value.code in (4403, 4404)