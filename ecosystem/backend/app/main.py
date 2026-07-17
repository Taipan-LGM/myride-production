from fastapi import FastAPI
import os

app = FastAPI(title="My Ride API", version="0.1.0")

@app.get("/")
async def root():
    return {"status": "ok", "message": "My Ride API is running"}

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "services": {
            "openai": "dev-mock",
            "stripe": "dev-mock",
            "twilio": "dev-mock"
        }
    }

@app.post("/api/rides/book")
async def book_ride(data: dict):
    return {
        "status": "success",
        "ride_id": f"ride_{os.urandom(4).hex()}",
        "message": "Ride booked successfully (mock mode)"
    }
