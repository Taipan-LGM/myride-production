# run.py
import sys
import os

# Add the current directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Try importing uvicorn
try:
    import uvicorn
    print("✅ uvicorn found!")
except ImportError as e:
    print(f"❌ uvicorn not found: {e}")
    print(f"Python path: {sys.path}")
    sys.exit(1)

# Run the app
if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    
    # Try to import your app
    try:
        from app.main import app
        print("✅ App imported successfully!")
    except ImportError as e:
        print(f"❌ Could not import app: {e}")
        print("Creating a simple fallback app...")
        from fastapi import FastAPI
        app = FastAPI(title="My Ride Fallback API")
        
        @app.get("/")
        async def root():
            return {"status": "ok", "message": "My Ride API is running"}
        
        @app.get("/health")
        async def health():
            return {"status": "healthy", "version": "0.1.0"}
    
    uvicorn.run(app, host="0.0.0.0", port=port)
