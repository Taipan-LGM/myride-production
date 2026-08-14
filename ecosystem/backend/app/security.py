"""Production security: headers + simple in-memory rate limiting."""

from __future__ import annotations

import os
import time
from collections import defaultdict, deque
from typing import Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(self), microphone=()"
        response.headers["X-My-Ride"] = "sa-ecosystem"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' https://unpkg.com; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "img-src 'self' data: https:; "
            "connect-src 'self' ws: wss:; "
            "frame-ancestors 'none'"
        )
        if os.getenv("ENVIRONMENT", "development").lower() == "production":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        if request.url.path.startswith("/api") or request.url.path.startswith("/auth"):
            response.headers["Cache-Control"] = "no-store"
        return response


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Token-bucket-ish sliding window per IP (dev-friendly defaults)."""

    def __init__(self, app, max_requests: int = 120, window_seconds: int = 60) -> None:
        super().__init__(app)
        self.max_requests = max_requests
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    # Paths that browsers / ops / providers probe often — do not burn the bucket
    _SKIP_PREFIXES = ("/static", "/health", "/favicon", "/webhooks", "/voice", "/ops")

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        path = request.url.path
        if any(path.startswith(p) for p in self._SKIP_PREFIXES):
            return await call_next(request)
        ip = request.client.host if request.client else "unknown"
        now = time.time()
        q = self._hits[ip]
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= self.max_requests:
            return Response(
                '{"detail":"Rate limit exceeded — wait a moment and retry."}',
                status_code=429,
                media_type="application/json",
            )
        response = await call_next(request)
        # Do not count auth failures / not-found toward the limit (admin tab
        # polls without a token otherwise starve the whole hub).
        if response.status_code not in (401, 403, 404):
            q.append(now)
            # Periodically purge IPs with no recent activity to bound memory growth.
            if len(self._hits) > 5000 and int(now) % 60 == 0:
                cutoff = now - self.window * 2
                self._hits = {ip: q for ip, q in self._hits.items() if q and q[-1] > cutoff}
            return response
