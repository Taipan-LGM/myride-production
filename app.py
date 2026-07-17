# app.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional
import uvicorn
import os

# Import the stripe service
from services.stripe_service import create_payment_intent, is_stripe_configured

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
    payment_method: str = "cash"  # "cash" or "card"

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
        "stripe_configured": is_stripe_configured()
    }

@app.post("/api/rides/book")
async def book_ride(booking: RideBooking):
    """Book a ride."""
    # Simple mock response
    return {
        "status": "searching",
        "ride_id": f"ride_{booking.rider_id}_{os.urandom(4).hex()}",
        "message": "Looking for nearby drivers...",
        "pickup": {"lat": booking.pickup_lat, "lng": booking.pickup_lng},
        "dropoff": {"lat": booking.dropoff_lat, "lng": booking.dropoff_lng},
        "estimated_fare": 45.50,
        "payment_method": booking.payment_method
    }

@app.post("/api/payments/create-intent")
async def create_payment(amount: float, currency: str = "zar"):
    """Create a Stripe payment intent."""
    if not is_stripe_configured():
        raise HTTPException(
            status_code=400,
            detail="Card payments are not configured. Please use cash."
        )
    
    result = create_payment_intent(amount, currency)
    if not result.success:
        raise HTTPException(status_code=400, detail=result.error)
    
    return {
        "client_secret": result.client_secret,
        "payment_id": result.payment_id,
        "amount": result.amount,
        "currency": result.currency
    }

if __name__ == "__main__":
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
