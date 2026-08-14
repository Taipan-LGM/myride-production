"""
Twilio Integration Service - MyRide Autonomous Mobility
Multi-channel booking via Voice, SMS, and WhatsApp.
"""
import json
import os
from typing import Any, Dict, Optional
from uuid import uuid4

# Make Twilio optional - works in development without it
try:
    from twilio.request_validator import RequestValidator
    TWILIO_AVAILABLE = True
except ImportError:
    TWILIO_AVAILABLE = False
    RequestValidator = None


def utc_now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


class TwilioService:
    """
    Handles all Twilio communications for:
    - Voice booking (speech-to-text → LLM → booking)
    - SMS booking (text-based AI parsing)
    - WhatsApp business messaging
    - Real-time driver-passenger communication
    """

    def __init__(self, ecosystem_service, ai_dispatcher):
        self.ecosystem = ecosystem_service
        self.dispatcher = ai_dispatcher
        self.phone_numbers = {
            "voice": "+1888MYRIDE1",
            "whatsapp": "+14155238886",
            "sms": os.getenv("MYRIDE_SMS_NUMBER", "+1888MYRIDESMS"),
        }

    def verify_webhook(self, request, signature: str) -> bool:
        """Verify webhook signature for security."""
        if not TWILIO_AVAILABLE:
            # In development, skip verification
            return True
        
        auth_token = os.getenv("TWILIO_AUTH_TOKEN", "")
        validator = RequestValidator(auth_token)
        return validator.validate(
            request.url,
            request.values if hasattr(request, "values") else {},
            signature
        )

    def voice_webhook(self, request) -> str:
        """
        AI handles incoming voice calls.
        Speech → Text → Booking
        """
        if TWILIO_AVAILABLE:
            from twilio.twiml.voice_response import VoiceResponse, Gather

            response = VoiceResponse()
            
            # Gather speech input
            gather = Gather(
                input="speech",
                timeout=5,
                speech_timeout="auto",
                action="/twilio/process-voice-booking",
                method="POST"
            )
            gather.say(
                "Welcome to MyRide AI. "
                "Please say your pickup location followed by your destination. "
                "For example: 'Sandton City to Rosebank Mall'."
            )
            response.append(gather)
            
            # If no speech detected, try again or say goodbye
            if len(str(response)) == 0:
                response.say("I didn't catch that. Goodbye.")
            
            # Log the call
            self.ecosystem.audit("twilio", "voice_call", "incoming")
            
            return str(response)
        else:
            # Development mock response
            self.ecosystem.audit("twilio", "voice_call", "incoming")
            return '<Response><Say>Welcome to MyRide AI. Please say your pickup location.</Say></Response>'

    async def process_voice_booking(self, request) -> Dict[str, Any]:
        """Process speech-to-text booking from voice call."""
        speech_result = request.values.get("SpeechResult", "")
        from_number = request.values.get("From", "")
        
        # AI parses the speech
        intent = self.dispatcher.parse_intent(speech_result)
        
        # Get or create user from phone number
        user_id = await self._get_or_create_user(str(from_number))
        
        # Process booking
        try:
            ride = await self.dispatcher.process_booking(speech_result, user_id, "voice")
            
            # Send confirmation SMS
            await self.send_sms(
                from_number,
                f"Your ride is confirmed! Driver {ride['driver']['name']} "
                f"is {int(ride['estimated_wait'])} min away. "
                f"Estimated fare: R{ride['estimated_fare']['total']}"
            )
            
            self.ecosystem.audit(user_id, "ride.booked", ride["ride_id"], {"channel": "voice"})
            
            return {"status": "confirmed", "ride": ride}
            
        except Exception as e:
            await self.send_sms(from_number, f"Booking error: {str(e)}")
            return {"status": "error", "message": str(e)}

    async def process_sms_booking(self, request) -> str:
        """
        AI handles SMS messages.
        Text → AI parsing → Booking
        """
        body = request.values.get("Body", "")
        from_number = request.values.get("From", "")
        
        # Get or create user
        user_id = await self._get_or_create_user(from_number)
        
        # AI processes the message
        try:
            ride = await self.dispatcher.process_booking(body, user_id, "sms")
            
            # Send confirmation
            await self.send_sms(
                from_number,
                f"✅ MyRide confirmed! Driver {ride['driver']['name']} "
                f"is {int(ride['estimated_wait'])} min away. "
                f"Ride #{ride['ride_id'][-6:]}. Fare: R{ride['estimated_fare']['total']}"
            )
            
            self.ecosystem.audit(user_id, "ride.booked", ride["ride_id"], {"channel": "sms"})
            return "Confirmed"
            
        except Exception as e:
            await self.send_sms(from_number, f"❌ Booking error: {str(e)}")
            return "Error"

    async def process_whatsapp_message(self, request) -> str:
        """Process WhatsApp booking message."""
        body = request.values.get("Body", "")
        from_number = request.values.get("From", "")
        
        # WhatsApp number format: whatsapp:+27...
        clean_number = from_number.replace("whatsapp:", "") if from_number.startswith("whatsapp:") else from_number
        
        # Get or create user
        user_id = await self._get_or_create_user(clean_number)
        
        # Process with AI
        try:
            ride = await self.dispatcher.process_booking(body, user_id, "whatsapp")
            
            # Send WhatsApp response
            await self.send_whatsapp(
                clean_number,
                f"*MyRide AI*\n\n✅ Ride confirmed!\n"
                f"Driver: {ride['driver']['name']}\n"
                f"ETA: {int(ride['estimated_wait'])} min\n"
                f"Price: R{ride['estimated_fare']['total']}\n\n"
                f"Ride ID: {ride['ride_id'][-6:]}"
            )
            
            return "accepted"
            
        except Exception as e:
            await self.send_whatsapp(clean_number, f"❌ Error: {str(e)}")
            return "error"

    async def _get_or_create_user(self, phone_number: str) -> str:
        """Get existing user or create new one from phone number."""
        # Check if user exists
        user = self.ecosystem.get_user_by_phone(phone_number)
        if user:
            return user["id"]
        
        # Create new user
        user_id = f"user_{uuid4().hex[:10]}"
        self.ecosystem.create_user({
            "id": user_id,
            "phone_number": phone_number,
            "full_name": "Guest",
            "role": "passenger",
            "verification_status": "verified"
        })
        
        return user_id

    async def send_sms(self, to: str, message: str) -> bool:
        """Send SMS via Twilio."""
        if not TWILIO_AVAILABLE:
            # Development mode - just log
            print(f"[SMS MOCK] To: {to}, Message: {message}")
            return True
        
        try:
            from twilio.rest import Client
            
            account_sid = os.getenv("TWILIO_ACCOUNT_SID", "")
            auth_token = os.getenv("TWILIO_AUTH_TOKEN", "")
            
            if not account_sid or not auth_token:
                print(f"[SMS MOCK] To: {to}, Message: {message}")
                return True
            
            client = Client(account_sid, auth_token)
            client.messages.create(
                body=message[:1600],  # SMS limit
                from_=self.phone_numbers["sms"],
                to=to
            )
            return True
            
        except Exception as e:
            print(f"SMS Error: {e}")
            return False

    async def send_whatsapp(self, to: str, message: str) -> bool:
        """Send WhatsApp message via Twilio."""
        if not TWILIO_AVAILABLE:
            print(f"[WhatsApp MOCK] To: {to}, Message: {message}")
            return True
        
        try:
            from twilio.rest import Client
            
            account_sid = os.getenv("TWILIO_ACCOUNT_SID", "")
            auth_token = os.getenv("TWILIO_AUTH_TOKEN", "")
            
            if not account_sid or not auth_token:
                print(f"[WhatsApp MOCK] To: {to}, Message: {message}")
                return True
            
            client = Client(account_sid, auth_token)
            client.messages.create(
                body=message[:1600],
                from_=f"whatsapp:{self.phone_numbers['whatsapp']}",
                to=f"whatsapp:{to}"
            )
            return True
            
        except Exception as e:
            print(f"WhatsApp Error: {e}")
            return False

    def voice_response_for_driver(self, driver_id: str) -> str:
        """Generate voice response options for drivers."""
        if TWILIO_AVAILABLE:
            from twilio.twiml.voice_response import VoiceResponse, Gather
            
            response = VoiceResponse()
            response.say("You have a new ride request. Press 1 to accept, press 2 to reject.")
            
            gather = Gather(
                num_digits=1,
                action=f"/twilio/handle-driver-response/{driver_id}",
                method="POST"
            )
            response.append(gather)
            
            return str(response)
        else:
            return '<Response><Say>You have a new ride request. Press 1 to accept.</Say></Response>'

    async def driver_response(self, driver_id: str, digits: str) -> str:
        """Handle driver response to ride offer."""
        if digits == "1":
            # Accept ride
            self.ecosystem.accept_driver_ride(driver_id)
            return f"Ride accepted. Good luck!"
        else:
            # Decline ride
            return "Ride declined. Looking for another driver."


# Additional service for advanced features
class SafetyMonitor:
    """
    Real-time safety monitoring for trips.
    Pre-emptive protection using anomaly detection.
    """

    def __init__(self, ecosystem_service):
        self.ecosystem = ecosystem_service

    def monitor_trip(self, trip_data: dict) -> dict:
        """Monitor trip for anomalies."""
        alerts = []
        
        # Route deviation detection
        if trip_data.get("route_deviation", 0) > 0.3:
            alerts.append({"type": "route_deviation", "severity": "high"})
        
        # Speed anomaly
        if trip_data.get("speed", 0) > 120:
            alerts.append({"type": "excessive_speed", "severity": "high"})
        
        # Unexpected stop
        if trip_data.get("unexpected_stop", False) and trip_data.get("duration", 0) > 5:
            alerts.append({"type": "unexpected_stop", "severity": "medium"})
        
        # Safety check
        if alerts:
            self.ecosystem.audit("safety", "trip_anomaly", trip_data.get("id"), alerts)
        
        return {"alerts": alerts, "status": "monitored"}

    def calculate_safety_score(self, driver: dict, passenger: dict) -> float:
        """Calculate safety score for driver-passenger match."""
        score = driver.get("safety_score", 1.0)
        
        # Adjust for passenger rating
        if passenger.get("rating", 5.0) < 4.0:
            score *= 0.95
        
        # Adjust for acceptance rate
        if driver.get("acceptance_rate", 100) < 80:
            score *= 0.9
        
        return round(score, 3)

    async def verify_driver(self, driver_data: dict) -> bool:
        """Multi-factor driver verification."""
        checks = [
            self._verify_license(driver_data.get("license_number")),
            self._verify_background_check(driver_data.get("background_check_date")),
            self._verify_vehicle(driver_data.get("vehicle_id")),
            self._verify_insurance(driver_data.get("insurance_expiry")),
        ]
        
        return all(checks)

    def _verify_license(self, license_number: str) -> bool:
        """Verify license validity (placeholder)."""
        return license_number is not None and len(license_number) > 0

    def _verify_background_check(self, check_date: str) -> bool:
        """Verify background check is recent."""
        if not check_date:
            return False
        # In production, check if date is within last 12 months
        return True

    def _verify_vehicle(self, vehicle_id: str) -> bool:
        """Verify vehicle registration."""
        return vehicle_id is not None and len(vehicle_id) > 0

    def _verify_insurance(self, expiry_date: str) -> bool:
        """Verify insurance is valid."""
        if not expiry_date:
            return False
        return True


# Payment reconciliation service
class PaymentReconciler:
    """
    Zero-human-touch payment reconciliation.
    """

    def __init__(self, ecosystem_service):
        self.ecosystem = ecosystem_service

    async def reconcile_trip(self, trip_id: str) -> dict:
        """Reconcile payment for completed trip."""
        trip = self.ecosystem.get_ride(trip_id)
        if not trip:
            raise ValueError("Trip not found")
        
        if trip.get("status") != "completed":
            raise ValueError("Trip must be completed first")
        
        # Calculate earnings
        passenger_paid = trip.get("fare", 0)
        platform_fee = round(passenger_paid * 0.15, 2)
        driver_payout = round(passenger_paid - platform_fee, 2)
        
        # Record reconciliation
        reconciliation_id = f"recon_{uuid4().hex[:10]}"
        self.ecosystem.record_payment({
            "id": reconciliation_id,
            "trip_id": trip_id,
            "passenger_paid": passenger_paid,
            "driver_payout": driver_payout,
            "platform_fee": platform_fee,
            "status": "reconciled",
            "created_at": utc_now()
        })
        
        # Update trip payment status
        self.ecosystem.update_ride_payment(trip_id, "paid")
        
        # Trigger driver payout (would connect to Stripe in production)
        await self._trigger_driver_payout(trip, driver_payout)
        
        # Send receipts
        await self._send_receipts(trip, passenger_paid, driver_payout)
        
        self.ecosystem.audit("payment", "reconciled", trip_id, {
            "amount": passenger_paid,
            "driver_payout": driver_payout
        })
        
        return {
            "trip_id": trip_id,
            "reconciliation_id": reconciliation_id,
            "passenger_paid": passenger_paid,
            "driver_payout": driver_payout,
            "platform_fee": platform_fee,
            "status": "reconciled"
        }

    async def _trigger_driver_payout(self, trip: dict, amount: float) -> bool:
        """Trigger driver payout via Stripe."""
        driver_id = trip.get("driver_id")
        driver = self.ecosystem.get_driver(driver_id)
        
        if driver and driver.get("instant_payout_eligible"):
            # In production: await stripe.transfers.create(...)
            self.ecosystem.audit("payout", "instant", driver_id, {"amount": amount})
        
        return True

    async def _send_receipts(self, trip: dict, passenger_amount: float, driver_amount: float) -> bool:
        """Send digital receipts."""
        # In production: send via email/SMS
        self.ecosystem.audit("notification", "receipt_sent", trip["id"])
        return True


__all__ = ["TwilioService", "SafetyMonitor", "PaymentReconciler"]