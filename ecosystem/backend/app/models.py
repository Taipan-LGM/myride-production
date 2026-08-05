from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class UserRole(str, Enum):
    rider = "rider"
    driver = "driver"
    admin = "admin"


class TripStatus(str, Enum):
    requested = "requested"
    driver_assigned = "driver_assigned"
    driver_arriving = "driver_arriving"
    in_progress = "in_progress"
    completed = "completed"
    cancelled = "cancelled"


class PaymentStatus(str, Enum):
    pending = "pending"
    authorized = "authorized"
    captured = "captured"
    refunded = "refunded"
    failed = "failed"


class RemunerationPolicyUpdate(BaseModel):
    driver_share_bps: int = Field(..., ge=0, le=10000)


class RefundTripRequest(BaseModel):
    reason: str = Field(default="requested_by_customer", min_length=3, max_length=200)


class GeoPoint(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)


class RiderProfile(BaseModel):
    id: str
    name: str
    phone: str | None = None
    email: str | None = None
    default_payment_method_id: str | None = None
    created_at: datetime | None = None


class DriverProfile(BaseModel):
    id: str
    name: str
    phone: str | None = None
    vehicle_make: str | None = None
    vehicle_model: str | None = None
    vehicle_plate: str | None = None
    stripe_account_id: str | None = None
    location: GeoPoint | None = None
    geohash: str | None = None
    is_online: bool = False
    rating: float = 5.0
    created_at: datetime | None = None


class Trip(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    rider_id: str
    driver_id: str | None = None
    status: TripStatus = TripStatus.requested
    pickup: GeoPoint
    dropoff: GeoPoint
    pickup_address: str | None = None
    dropoff_address: str | None = None
    fare_estimate_cents: int | None = None
    fare_final_cents: int | None = None
    driver_share_bps: int | None = Field(default=None, ge=0, le=10000)
    remuneration_policy_version: int | None = Field(default=None, ge=1)
    driver_payout_cents: int | None = Field(default=None, ge=0)
    platform_fee_cents: int | None = Field(default=None, ge=0)
    reconciliation_status: str | None = None
    reconciliation_attempt_count: int = Field(default=0, ge=0)
    reconciliation_attempted_at: datetime | None = None
    reconciliation_error: str | None = None
    transfer_id: str | None = None
    reconciled_at: datetime | None = None
    refund_status: str | None = None
    refund_attempt_count: int = Field(default=0, ge=0)
    refund_attempted_at: datetime | None = None
    refund_error: str | None = None
    refund_id: str | None = None
    transfer_reversal_id: str | None = None
    refunded_amount_cents: int | None = Field(default=None, ge=0)
    refunded_at: datetime | None = None
    currency: str = "zar"
    payment_intent_id: str | None = None
    payment_status: PaymentStatus = PaymentStatus.pending
    captured_amount_cents: int | None = Field(default=None, ge=0)
    booking_channel: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class TripCreateRequest(BaseModel):
    rider_id: str
    pickup: GeoPoint
    dropoff: GeoPoint
    pickup_address: str | None = None
    dropoff_address: str | None = None
    fare_estimate_cents: int | None = None
    notes: str | None = None


class TripAssignRequest(BaseModel):
    driver_id: str


class DriverLocationUpdate(BaseModel):
    driver_id: str
    location: GeoPoint
    is_online: bool = True


class NearbyDriversRequest(BaseModel):
    center: GeoPoint
    radius_km: float = Field(default=5.0, gt=0, le=50)
    limit: int = Field(default=10, ge=1, le=50)


class NearbyDriver(BaseModel):
    driver: DriverProfile
    distance_km: float


class AiParseRequest(BaseModel):
    text: str
    user_id: str | None = None
    channel: str = "text"  # text | voice | whatsapp


class AiParseResponse(BaseModel):
    intent: str
    confidence: float
    entities: dict[str, Any] = Field(default_factory=dict)
    reply: str | None = None
    suggested_trip: TripCreateRequest | None = None


class AiBookRequest(BaseModel):
    rider_id: str
    pickup: GeoPoint
    dropoff: GeoPoint
    pickup_address: str | None = None
    dropoff_address: str | None = None
    vehicle_type: str = "standard"
    passenger_rating: float = 5.0
    loyalty_tier: str = "bronze"
    fraud_signals: dict[str, Any] = Field(default_factory=dict)
    top_n: int = Field(default=3, ge=1, le=10)
    booking_channel: str = "app"  # app | web | voice | whatsapp | sms


class ChannelSimulateRequest(BaseModel):
    text: str
    from_number: str = "+27821234567"


class AiSupportRequest(BaseModel):
    user_id: str
    query: str
    channel: str = "chat"
    context: dict[str, Any] = Field(default_factory=dict)


class LoginRequest(BaseModel):
    identifier: str  # email or phone
    password: str
    role: str | None = None  # rider | driver | admin


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict[str, Any]


class PaymentHoldRequest(BaseModel):
    trip_id: str
    amount_cents: int
    rider_id: str
    currency: str = "usd"


class PaymentCaptureRequest(BaseModel):
    trip_id: str
    payment_intent_id: str
    amount_cents: int | None = None


class PaymentTransferRequest(BaseModel):
    trip_id: str
    driver_stripe_account_id: str
    amount_cents: int


class WhatsAppInbound(BaseModel):
    from_number: str
    body: str
    message_sid: str | None = None
    profile_name: str | None = None


class TwilioVoiceGather(BaseModel):
    call_sid: str
    from_number: str
    speech_result: str | None = None
    digits: str | None = None


class WebSocketEvent(BaseModel):
    type: str
    trip_id: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime | None = None


class HealthResponse(BaseModel):
    status: str
    version: str
    services: dict[str, str]


class CutoverReadyResponse(BaseModel):
    """Production cutover readiness — what is live vs still missing."""

    ready_for_public: bool
    host: str
    checks: dict[str, bool]
    missing: list[str]
    webhook_urls: dict[str, str]


class CreatePaymentIntentRequest(BaseModel):
    amount_cents: int
    rider_id: str
    trip_id: str | None = None
    currency: str = "zar"


class RequestRideRequest(BaseModel):
    rider_id: str
    pickup: GeoPoint
    dropoff: GeoPoint
    pickup_address: str | None = None
    dropoff_address: str | None = None
    payment_intent_id: str | None = None
    fare_estimate_cents: int | None = None
    distance_km: float | None = None
    duration_minutes: int | None = None
    surge_multiplier: float = 1.0


class DriverAvailabilityRequest(BaseModel):
    driver_id: str
    is_online: bool
    location: GeoPoint | None = None


class AcceptRideRequest(BaseModel):
    driver_id: str


class RejectRideRequest(BaseModel):
    driver_id: str
    reason: str | None = None


class ChatMessageRequest(BaseModel):
    trip_id: str
    message: str
    sender: str = "rider"


class RateDriverRequest(BaseModel):
    trip_id: str
    driver_id: str
    rating: int = Field(..., ge=1, le=5)
    comment: str | None = None


class FareEstimateRequest(BaseModel):
    pickup: GeoPoint
    dropoff: GeoPoint
    surge_multiplier: float = 1.0
    vehicle_type: str = "standard"
    loyalty_tier: str = "bronze"


class VoiceMessageRequest(BaseModel):
    text: str
    trip_id: str | None = None
    call_id: str | None = None


class ScheduleRideRequest(BaseModel):
    rider_id: str
    pickup: GeoPoint
    dropoff: GeoPoint
    pickup_address: str | None = None
    dropoff_address: str | None = None
    scheduled_for: datetime
    vehicle_type: str = "standard"


class RateTripRequest(BaseModel):
    trip_id: str
    rating: int = Field(..., ge=1, le=5)
    comment: str | None = None
    from_role: str = "rider"  # rider rates driver | driver rates rider
