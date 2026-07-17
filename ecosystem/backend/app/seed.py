from __future__ import annotations

from app.firestore_db import FirestoreDB
from app.models import GeoPoint


async def seed_demo_data(db: FirestoreDB) -> dict[str, list[str]]:
    """Insert demo riders, drivers, and a sample trip (idempotent by fixed IDs)."""
    rider = await db.create_rider(
        {
            "id": "rider-demo-001",
            "name": "Amina K.",
            "phone": "+27821234567",
            "email": "amina@example.com",
        }
    )

    drivers_spec = [
        {
            "id": "driver-demo-001",
            "name": "James O.",
            "phone": "+27829876543",
            "vehicle_make": "standard",
            "vehicle_model": "Corolla",
            "vehicle_plate": "CA 123 GP",
            "location": GeoPoint(lat=-33.9249, lng=18.4241),
            "rating": 4.9,
        },
        {
            "id": "driver-demo-002",
            "name": "Thandi M.",
            "phone": "+27821112222",
            "vehicle_make": "standard",
            "vehicle_model": "Polo",
            "vehicle_plate": "CA 456 GP",
            "location": GeoPoint(lat=-33.9265, lng=18.4280),
            "rating": 4.7,
        },
        {
            "id": "driver-demo-003",
            "name": "Pieter V.",
            "phone": "+27823334444",
            "vehicle_make": "premium",
            "vehicle_model": "C-Class",
            "vehicle_plate": "CA 789 GP",
            "location": GeoPoint(lat=-33.9210, lng=18.4200),
            "rating": 4.95,
        },
        {
            "id": "driver-demo-jhb",
            "name": "Sipho N.",
            "phone": "+27825556666",
            "vehicle_make": "standard",
            "vehicle_model": "i20",
            "vehicle_plate": "GP 321 JHB",
            "location": GeoPoint(lat=-26.2041, lng=28.0473),
            "rating": 4.8,
        },
    ]

    driver_ids: list[str] = []
    for spec in drivers_spec:
        driver = await db.create_driver({**spec, "is_online": True})
        driver_ids.append(driver.id)

    trip = await db.create_trip(
        {
            "id": "trip-demo-001",
            "rider_id": rider.id,
            "driver_id": driver_ids[0],
            "pickup": GeoPoint(lat=-33.9249, lng=18.4241).model_dump(),
            "dropoff": GeoPoint(lat=-33.9180, lng=18.4232).model_dump(),
            "pickup_address": "Cape Town CBD",
            "dropoff_address": "V&A Waterfront",
            "fare_estimate_cents": 8500,
            "currency": "zar",
        }
    )
    return {
        "riders": [rider.id],
        "drivers": driver_ids,
        "trips": [trip.id],
    }
