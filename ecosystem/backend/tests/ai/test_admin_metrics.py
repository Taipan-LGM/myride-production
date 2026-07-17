from __future__ import annotations

import pytest

from app.admin_metrics import collect_admin_metrics
from app.firestore_db import FirestoreDB
from app.models import GeoPoint


@pytest.mark.asyncio
async def test_admin_metrics_shape():
    db = FirestoreDB()
    await db.connect()
    await db.create_driver(
        {
            "id": "d-metrics",
            "name": "M",
            "phone": "+27000000000",
            "location": GeoPoint(lat=-33.92, lng=18.42).model_dump(),
            "is_online": True,
        }
    )
    metrics = await collect_admin_metrics(db)
    assert "live_rides" in metrics
    assert "active_drivers" in metrics
    assert metrics["currency"] == "ZAR"
    assert metrics["ai_resolution_rate"] >= 0
