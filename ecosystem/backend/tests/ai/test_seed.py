import pytest

from app.firestore_db import FirestoreDB
from app.seed import seed_demo_data


@pytest.mark.asyncio
async def test_demo_seed_includes_reconciled_payment_trip():
    db = FirestoreDB()
    await db.connect()

    result = await seed_demo_data(db)

    trip = await db.get_trip("trip-payment-demo-001")
    assert trip is not None
    assert trip.id in result["trips"]
    assert trip.payment_status.value == "captured"
    assert trip.reconciliation_status == "reconciled"
    assert trip.transfer_id
    records = await db.list_payment_records()
    assert len([record for record in records if record["trip_id"] == trip.id]) == 1