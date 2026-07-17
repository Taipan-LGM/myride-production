#!/usr/bin/env python3
"""Run the My Ride FastAPI server."""

from __future__ import annotations

import os

import uvicorn

from app.config import get_settings


def main() -> None:
    settings = get_settings()
    # Render (and most PaaS) inject PORT — prefer it over API_PORT
    port = int(os.environ.get("PORT") or settings.api_port)
    host = os.environ.get("HOST") or settings.api_host
    uvicorn.run(
        "app.main:app",
        host=host,
        port=port,
        reload=settings.debug,
        log_level=settings.log_level,
    )


if __name__ == "__main__":
    main()
