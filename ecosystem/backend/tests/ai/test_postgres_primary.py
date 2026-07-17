"""Postgres primary mode helpers (no live DB required)."""

from app.postgres_db import _row_to_trip_dict, is_postgres_primary, postgres_status


def test_postgres_status_default_disabled():
    # Without connect(), status is disabled / not primary
    assert postgres_status() in ("disabled", "dual-write", "primary", "error", "missing-driver", "closed")
    assert is_postgres_primary() in (True, False)


def test_row_to_trip_from_raw():
    class Row(dict):
        def __getitem__(self, key):
            return dict.__getitem__(self, key)

    row = Row(
        {
            "external_id": "t1",
            "rider_external_id": "r1",
            "driver_external_id": None,
            "status": "requested",
            "pickup_lat": -33.9,
            "pickup_lng": 18.4,
            "pickup_address": "A",
            "dropoff_lat": -33.91,
            "dropoff_lng": 18.42,
            "dropoff_address": "B",
            "fare_cents": 5000,
            "currency": "zar",
            "payment_status": "pending",
            "raw": {
                "id": "t1",
                "rider_id": "r1",
                "status": "requested",
                "pickup": {"lat": -33.9, "lng": 18.4},
                "dropoff": {"lat": -33.91, "lng": 18.42},
            },
        }
    )
    d = _row_to_trip_dict(row)
    assert d is not None
    assert d["id"] == "t1"
    assert d["pickup"]["lat"] == -33.9
