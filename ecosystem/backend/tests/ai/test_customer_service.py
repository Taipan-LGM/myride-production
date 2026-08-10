from __future__ import annotations

import pytest

from app.ai.customer_service import (
    CustomerServiceAI,
    IssueCategory,
    ResolutionAction,
)


@pytest.fixture
def cs() -> CustomerServiceAI:
    return CustomerServiceAI()


@pytest.mark.asyncio
async def test_safety_escalates(cs: CustomerServiceAI):
    result = await cs.handle_query(
        user_id="rider-1",
        query="I feel unsafe, the driver is threatening me",
        context={"trip_id": "trip-1"},
    )
    assert result.category == IssueCategory.SAFETY
    assert result.action == ResolutionAction.ESCALATE_HUMAN
    assert result.needs_human is True


@pytest.mark.asyncio
async def test_refund_under_cap_processes(cs: CustomerServiceAI):
    result = await cs.handle_query(
        user_id="rider-1",
        query="I want a refund for my trip",
        context={
            "trip_id": "trip-1",
            "total_paid": 250.0,
            "status": "completed",
        },
    )
    assert result.category in (IssueCategory.REFUND, IssueCategory.PAYMENT)
    assert result.action == ResolutionAction.PROCESS_REFUND
    assert result.needs_human is False
    assert result.action_params["executed"] is False
    assert "eligible" in result.message


@pytest.mark.asyncio
async def test_refund_over_cap_escalates(cs: CustomerServiceAI):
    result = await cs.handle_query(
        user_id="rider-1",
        query="Please refund my fare",
        context={
            "trip_id": "trip-1",
            "total_paid": 750.0,
            "status": "completed",
        },
    )
    assert result.action == ResolutionAction.ESCALATE_HUMAN
    assert result.needs_human is True


@pytest.mark.asyncio
async def test_cancel_requested_trip(cs: CustomerServiceAI):
    result = await cs.handle_query(
        user_id="rider-1",
        query="Please cancel my ride",
        context={"trip_id": "trip-1", "status": "requested"},
    )
    assert result.category == IssueCategory.CANCELLATION
    assert result.action == ResolutionAction.CANCEL_TRIP
