# app/main.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional
import os
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="My Ride AI API",
    description="AI-operated ride ecosystem",
    version="0.1.0"
)

# ========== MODELS ==========

class RideBooking(BaseModel):
    rider_id: str
    pickup_lat: float
    pickup_lng: float
    dropoff_lat: float
    dropoff_lng: float
    payment_method: str = "cash"

# ========== ROUTES ==========

@app.get("/")
async def root():
    return {
        "service": "My Ride AI API",
        "status": "running",
        "version": "0.1.0"
    }

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "stripe_configured": False,  # Will be updated later
        "services": {
            "openai": "dev-mock",
            "stripe": "dev-mock",
            "twilio": "dev-mock"
        }
    }

@app.post("/api/rides/book")
async def book_ride(booking: RideBooking):
    """Book a ride."""
    logger.info(f"Booking request: {booking}")
    
    return {
        "status": "success",
        "ride_id": f"ride_{booking.rider_id}_{os.urandom(4).hex()}",
        "message": "Ride booked successfully (mock mode)",
        "pickup": {"lat": booking.pickup_lat, "lng": booking.pickup_lng},
        "dropoff": {"lat": booking.dropoff_lat, "lng": booking.dropoff_lng},
        "estimated_fare": 45.50,
        "payment_method": booking.payment_method
    }

@app.post("/api/payments/create-intent")
async def create_payment(amount: float, currency: str = "zar"):
    """Create a Stripe payment intent (mock)."""
    return {
        "success": True,
        "client_secret": f"mock_secret_{os.urandom(8).hex()}",
        "payment_id": f"mock_payment_{os.urandom(4).hex()}",
        "amount": amount,
        "currency": currency,
        "note": "Mock payment - Set STRIPE_SECRET_KEY for real payments"
    }
