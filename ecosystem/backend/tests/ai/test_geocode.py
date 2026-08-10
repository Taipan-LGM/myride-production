from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


def test_geocode_search_short_query_empty():
    with TestClient(app) as client:
        res = client.get("/geocode/search?q=a")
        assert res.status_code == 200
        assert res.json()["results"] == []


def test_geocode_reverse_fallback_shape():
    with TestClient(app) as client:
        res = client.get("/geocode/reverse?lat=-33.9249&lng=18.4241")
        assert res.status_code == 200
        body = res.json()
        assert "label" in body
        assert "lat" in body and "lng" in body
