"""Part 12 ML layer tests."""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.ml.features import eta_features, surge_features
from app.ml.store import LinearModel, ModelStore, predict_eta_seconds, predict_surge_multiplier
from app.ml.trainer import _synthetic_samples


def test_linear_model_learns_simple():
    m = LinearModel(name="t", lr=0.1)
    xs = [[1.0, 0.0], [1.0, 1.0], [1.0, 2.0]]
    ys = [1.0, 2.0, 3.0]
    metrics = m.batch_fit(xs, ys, epochs=40)
    assert metrics["samples"] == 3
    assert m.predict([1.0, 1.5]) == pytest.approx(2.5, abs=0.5)


def test_surge_features_dim():
    x = surge_features(hour=8, dow=1, demand=20, supply=5, distance_km=10)
    assert len(x) == 7
    assert x[0] == 1.0


def test_predict_uses_store(tmp_path: Path):
    store = ModelStore(root=tmp_path)
    sx, sy, ex, ey = _synthetic_samples(40)
    store.surge.batch_fit(sx, sy, epochs=5)
    store.eta.batch_fit(ex, ey, epochs=5)
    store.save()
    # Rebind global for this test
    import app.ml.store as ms

    ms._store = store
    s = predict_surge_multiplier(base_surge=1.2, hour=8, dow=1, demand=20, supply=5)
    assert 1.0 <= s <= 5.0
    eta = predict_eta_seconds(5.0, hour=8, dow_v=1)
    assert eta >= 60.0


@pytest.mark.asyncio
async def test_ml_status_and_train():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        st = await client.get("/ai/ml/status")
        assert st.status_code == 200
        assert "surge" in st.json()

        login = await client.post(
            "/auth/login",
            json={"identifier": "admin@myride.co.za", "password": "admin123", "role": "admin"},
        )
        token = login.json()["access_token"]
        r = await client.post("/ai/ml/train", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        body = r.json()
        assert body["ok"] is True
        assert body["surge"]["samples"] >= 50
