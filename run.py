import os
import uvicorn

# Run the app
if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    from app import app

    uvicorn.run(app, host="0.0.0.0", port=port)
