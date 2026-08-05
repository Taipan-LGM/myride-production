"""LLM/heuristic customer service with autonomous resolution actions."""

from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any

from app.config import Settings, get_settings

logger = logging.getLogger(__name__)


class IssueCategory(str, Enum):
    CANCELLATION = "cancellation"
    REFUND = "refund"
    PAYMENT = "payment"
    LOST_ITEM = "lost_item"
    SAFETY = "safety"
    DRIVER_COMPLAINT = "driver_complaint"
    PASSENGER_COMPLAINT = "passenger_complaint"
    ACCOUNT = "account"
    TECHNICAL = "technical"
    OTHER = "other"


class ResolutionAction(str, Enum):
    PROCESS_REFUND = "process_refund"
    MODIFY_TRIP = "modify_trip"
    CANCEL_TRIP = "cancel_trip"
    CONTACT_DRIVER = "contact_driver"
    SEND_COMPENSATION = "send_compensation"
    ESCALATE_HUMAN = "escalate_human"
    SEND_MESSAGE = "send_message"
    RECONCILE_PAYMENT = "reconcile_payment"
    NO_ACTION = "no_action"


@dataclass
class SupportResolution:
    category: IssueCategory
    message: str
    action: ResolutionAction
    action_params: dict[str, Any] = field(default_factory=dict)
    confidence: float = 0.0
    needs_human: bool = False
    human_notes: str = ""

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["category"] = self.category.value
        data["action"] = self.action.value
        return data


class CustomerServiceAI:
    """Autonomous support agent. OpenAI when keyed; heuristics otherwise."""

    MAX_AUTO_REFUND = 500.00  # ZAR
    CONFIDENCE_THRESHOLD = 0.85

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self._client = None
        if self.settings.openai_api_key:
            from openai import AsyncOpenAI

            self._client = AsyncOpenAI(api_key=self.settings.openai_api_key)
        self._system_prompt = self._load_prompt()

    def _load_prompt(self) -> str:
        path = Path(__file__).parent / "prompts" / "customer_service.md"
        if path.exists():
            return path.read_text(encoding="utf-8")
        return (
            "You are MyRide AI Customer Service. Resolve issues autonomously. "
            "Escalate safety and refunds over R500."
        )

    async def handle_query(
        self,
        user_id: str,
        query: str,
        channel: str = "chat",
        context: dict[str, Any] | None = None,
    ) -> SupportResolution:
        ctx = context or {}
        analysis = await self._analyze_issue(query, ctx)
        resolution = self._determine_resolution(analysis, ctx, query)
        if (
            resolution.confidence >= self.CONFIDENCE_THRESHOLD
            and resolution.action != ResolutionAction.ESCALATE_HUMAN
        ):
            resolution = await self._execute_action(resolution, user_id)
        return resolution

    async def _analyze_issue(self, query: str, context: dict[str, Any]) -> dict[str, Any]:
        if self._client:
            try:
                response = await self._client.chat.completions.create(
                    model=self.settings.openai_model,
                    response_format={"type": "json_object"},
                    messages=[
                        {"role": "system", "content": self._system_prompt},
                        {
                            "role": "user",
                            "content": (
                                f"Classify support query as JSON with keys: "
                                f"category, intent, urgency, sentiment, entities, reasoning.\n"
                                f"Context: {json.dumps(context)}\nQuery: {query}"
                            ),
                        },
                    ],
                    temperature=0.1,
                    max_tokens=500,
                )
                raw = response.choices[0].message.content or "{}"
                return json.loads(raw)
            except Exception as exc:
                logger.exception("CS LLM classify failed: %s", exc)
        return self._heuristic_classify(query)

    @staticmethod
    def _heuristic_classify(query: str) -> dict[str, Any]:
        text = query.lower()
        if any(w in text for w in ("unsafe", "threat", "attack", "emergency", "accident", "kidnap")):
            return {"category": "safety", "urgency": "high", "entities": {}, "intent": "safety"}
        if any(w in text for w in ("lost", "left my", "forgot")):
            return {"category": "lost_item", "urgency": "medium", "entities": {}, "intent": "lost_item"}
        if any(w in text for w in ("refund", "money back", "charged wrong")):
            return {"category": "refund", "urgency": "medium", "entities": {}, "intent": "refund"}
        if any(w in text for w in ("cancel", "stop the ride", "don't need")):
            return {"category": "cancellation", "urgency": "medium", "entities": {}, "intent": "cancel"}
        if any(w in text for w in ("payment", "card", "charged")):
            return {"category": "payment", "urgency": "medium", "entities": {}, "intent": "payment"}
        if any(w in text for w in ("driver", "rude", "complaint")):
            return {"category": "driver_complaint", "urgency": "medium", "entities": {"severity": "low"}, "intent": "complaint"}
        return {"category": "other", "urgency": "low", "entities": {}, "intent": "general"}

    def _determine_resolution(
        self,
        analysis: dict[str, Any],
        context: dict[str, Any],
        query: str,
    ) -> SupportResolution:
        category_raw = str(analysis.get("category", "other")).lower()
        urgency = str(analysis.get("urgency", "medium")).lower()
        entities = analysis.get("entities") or {}

        if category_raw == "safety" or urgency == "high":
            return SupportResolution(
                category=IssueCategory.SAFETY,
                message=(
                    "I understand this is serious. Escalating to our safety team now. "
                    "If you are in immediate danger, call emergency services at 112."
                ),
                action=ResolutionAction.ESCALATE_HUMAN,
                action_params={"trip_id": context.get("trip_id")},
                confidence=1.0,
                needs_human=True,
                human_notes=f"Safety: {analysis.get('reasoning', query)}",
            )

        if category_raw == "cancellation":
            return self._handle_cancellation(context)
        if category_raw in ("refund", "payment"):
            return self._handle_refund(context, entities, category_raw)
        if category_raw == "lost_item":
            return self._handle_lost_item(context, entities)
        if category_raw in ("driver_complaint", "passenger_complaint"):
            return self._handle_complaint(category_raw, entities, context)

        return SupportResolution(
            category=IssueCategory.OTHER,
            message=(
                "I can help with cancellations, refunds, lost items, and trip issues. "
                "Please share more detail or a trip ID."
            ),
            action=ResolutionAction.SEND_MESSAGE,
            action_params={"message": query},
            confidence=0.6,
        )

    def _handle_cancellation(self, context: dict[str, Any]) -> SupportResolution:
        trip_id = context.get("trip_id")
        status = str(context.get("status") or "").lower()
        if not trip_id:
            return SupportResolution(
                category=IssueCategory.CANCELLATION,
                message="I need a trip ID to cancel. Please provide it.",
                action=ResolutionAction.SEND_MESSAGE,
                confidence=0.7,
            )
        if status == "completed":
            return SupportResolution(
                category=IssueCategory.CANCELLATION,
                message="This trip is already completed and cannot be cancelled.",
                action=ResolutionAction.NO_ACTION,
                confidence=0.9,
            )
        if status in ("arrived", "started", "in_progress", "driver_arriving"):
            return SupportResolution(
                category=IssueCategory.CANCELLATION,
                message="Trip is in progress — cancelling may incur a fee. Confirm to proceed.",
                action=ResolutionAction.MODIFY_TRIP,
                action_params={"trip_id": trip_id, "action": "cancel"},
                confidence=0.85,
            )
        return SupportResolution(
            category=IssueCategory.CANCELLATION,
            message="I've cancelled your trip. No cancellation fee will be charged.",
            action=ResolutionAction.CANCEL_TRIP,
            action_params={"trip_id": trip_id},
            confidence=0.95,
        )

    def _handle_refund(
        self,
        context: dict[str, Any],
        entities: dict[str, Any],
        category_raw: str,
    ) -> SupportResolution:
        category = IssueCategory.REFUND if category_raw == "refund" else IssueCategory.PAYMENT
        trip_id = context.get("trip_id")
        if not trip_id:
            return SupportResolution(
                category=category,
                message="I need the trip ID to process a refund.",
                action=ResolutionAction.SEND_MESSAGE,
                confidence=0.6,
            )
        amount = float(context.get("total_paid") or entities.get("amount") or 0)
        if amount > self.MAX_AUTO_REFUND:
            return SupportResolution(
                category=category,
                message=(
                    f"Refund of R{amount:.2f} exceeds automatic limit "
                    f"(R{self.MAX_AUTO_REFUND:.2f}). Escalating to a human agent."
                ),
                action=ResolutionAction.ESCALATE_HUMAN,
                action_params={"trip_id": trip_id, "amount": amount},
                confidence=0.9,
                needs_human=True,
                human_notes=f"Refund R{amount:.2f} exceeds auto-limit",
            )
        return SupportResolution(
            category=category,
            message=f"Your R{amount:.2f} refund request is eligible and ready for secure payment review.",
            action=ResolutionAction.PROCESS_REFUND,
            action_params={
                "trip_id": trip_id,
                "amount": amount,
                "reason": entities.get("reason", "Customer request"),
            },
            confidence=0.9,
        )

    def _handle_lost_item(
        self,
        context: dict[str, Any],
        entities: dict[str, Any],
    ) -> SupportResolution:
        trip_id = context.get("trip_id")
        driver_id = context.get("driver_id")
        if not trip_id:
            return SupportResolution(
                category=IssueCategory.LOST_ITEM,
                message="I need the trip ID to contact your driver about a lost item.",
                action=ResolutionAction.SEND_MESSAGE,
                confidence=0.6,
            )
        if not driver_id:
            return SupportResolution(
                category=IssueCategory.LOST_ITEM,
                message="Driver not found for this trip — escalating to a human agent.",
                action=ResolutionAction.ESCALATE_HUMAN,
                action_params={"trip_id": trip_id},
                confidence=0.5,
                needs_human=True,
            )
        return SupportResolution(
            category=IssueCategory.LOST_ITEM,
            message=(
                "I've contacted your driver about your lost item. "
                "They will reach out via the app."
            ),
            action=ResolutionAction.CONTACT_DRIVER,
            action_params={
                "driver_id": driver_id,
                "trip_id": trip_id,
                "item_description": entities.get("item_description", "lost item"),
            },
            confidence=0.85,
        )

    def _handle_complaint(
        self,
        category_raw: str,
        entities: dict[str, Any],
        context: dict[str, Any],
    ) -> SupportResolution:
        category = (
            IssueCategory.DRIVER_COMPLAINT
            if category_raw == "driver_complaint"
            else IssueCategory.PASSENGER_COMPLAINT
        )
        severity = str(entities.get("severity", "low")).lower()
        if severity in ("high", "critical"):
            return SupportResolution(
                category=category,
                message="Serious complaint logged — safety team will investigate within 24 hours.",
                action=ResolutionAction.ESCALATE_HUMAN,
                action_params={"trip_id": context.get("trip_id"), "severity": severity},
                confidence=0.9,
                needs_human=True,
            )
        return SupportResolution(
            category=category,
            message="Thank you for the feedback. We've logged this for review.",
            action=ResolutionAction.NO_ACTION,
            action_params={"trip_id": context.get("trip_id")},
            confidence=0.85,
        )

    async def _execute_action(
        self,
        resolution: SupportResolution,
        user_id: str,
    ) -> SupportResolution:
        executed = resolution.action != ResolutionAction.PROCESS_REFUND
        resolution.action_params = {
            **resolution.action_params,
            "user_id": user_id,
            "executed": executed,
            "executor": "customer_service_ai" if executed else "refund_service_required",
        }
        return resolution
