"""My Ride AI Brain — SmartRouter, DynamicPricing, CustomerService, Fraud, Safety."""

from __future__ import annotations

from app.ai.customer_service import CustomerServiceAI, IssueCategory, ResolutionAction, SupportResolution
from app.ai.dynamic_pricing import DynamicPricingEngine, FareBreakdown
from app.ai.fraud_detection import FraudDetection, FraudVerdict
from app.ai.safety_monitor import SafetyAlert, SafetyAlertType, SafetyMonitor
from app.ai.smart_router import DriverScore, RideContext, SmartRouter

__all__ = [
    "CustomerServiceAI",
    "DriverScore",
    "DynamicPricingEngine",
    "FareBreakdown",
    "FraudDetection",
    "FraudVerdict",
    "IssueCategory",
    "ResolutionAction",
    "RideContext",
    "SafetyAlert",
    "SafetyAlertType",
    "SafetyMonitor",
    "SmartRouter",
    "SupportResolution",
]
