"""Role-based auth for Rider, Driver, and Admin (JWT + demo accounts)."""

from __future__ import annotations

import hashlib
import hmac
import asyncio
import json
import logging
import time
from dataclasses import dataclass
from collections.abc import Callable, Mapping
from typing import Any, Literal

from fastapi import Depends, HTTPException, WebSocket, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import Settings, get_settings

logger = logging.getLogger(__name__)

Role = Literal["rider", "driver", "admin"]

_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class AuthUser:
    id: str
    email: str | None
    name: str
    role: Role
    phone: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "email": self.email,
            "name": self.name,
            "role": self.role,
            "phone": self.phone,
        }


# Demo accounts for SA launch / local prod-like testing
_DEMO_USERS: dict[str, dict[str, Any]] = {
    "rider@myride.co.za": {
        "id": "rider-demo-001",
        "email": "rider@myride.co.za",
        "name": "Amina K.",
        "role": "rider",
        "phone": "+27821234567",
        "password": "ride123",
    },
    "driver@myride.co.za": {
        "id": "driver-demo-001",
        "email": "driver@myride.co.za",
        "name": "James O.",
        "role": "driver",
        "phone": "+27829876543",
        "password": "drive123",
    },
    "admin@myride.co.za": {
        "id": "admin-demo-001",
        "email": "admin@myride.co.za",
        "name": "Lance Muller",
        "role": "admin",
        "phone": "+27820000000",
        "password": "admin123",
    },
    # Phone aliases (SA)
    "+27821234567": "rider@myride.co.za",
    "+27829876543": "driver@myride.co.za",
    "+27820000000": "admin@myride.co.za",
}


def _secret(settings: Settings) -> bytes:
    raw = settings.jwt_secret or "my-ride-sa-dev-secret-change-me"
    return raw.encode("utf-8")


def _b64url(data: bytes) -> str:
    import base64

    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    import base64

    pad = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + pad)


def create_token(user: AuthUser, settings: Settings | None = None, ttl_seconds: int = 86400 * 7) -> str:
    """Compact HMAC-signed token (no external JWT dependency)."""
    import json

    settings = settings or get_settings()
    header = _b64url(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = _b64url(
        json.dumps(
            {
                "sub": user.id,
                "email": user.email,
                "name": user.name,
                "role": user.role,
                "phone": user.phone,
                "exp": int(time.time()) + ttl_seconds,
            }
        ).encode()
    )
    signing_input = f"{header}.{payload}".encode()
    sig = hmac.new(_secret(settings), signing_input, hashlib.sha256).digest()
    return f"{header}.{payload}.{_b64url(sig)}"


def decode_token(token: str, settings: Settings | None = None) -> AuthUser:
    import json

    settings = settings or get_settings()
    try:
        header_b64, payload_b64, sig_b64 = token.split(".")
    except ValueError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token") from exc

    signing_input = f"{header_b64}.{payload_b64}".encode()
    expected = hmac.new(_secret(settings), signing_input, hashlib.sha256).digest()
    if not hmac.compare_digest(expected, _b64url_decode(sig_b64)):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token signature")

    payload = json.loads(_b64url_decode(payload_b64))
    if int(payload.get("exp", 0)) < int(time.time()):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token expired")

    email = payload.get("email")
    return AuthUser(
        id=str(payload["sub"]),
        email=str(email) if email else None,
        name=str(payload.get("name") or ""),
        role=payload["role"],  # type: ignore[arg-type]
        phone=payload.get("phone"),
    )


def authenticate(
    identifier: str,
    password: str,
    role: Role | None = None,
    *,
    allow_demo: bool | None = None,
) -> AuthUser:
    settings = get_settings()
    if allow_demo is None:
        allow_demo = bool(settings.allow_demo_accounts)
    key = identifier.strip().lower()
    if key.startswith("+") or key.isdigit():
        # normalize phone lookup
        phone_key = identifier.strip()
        mapped = _DEMO_USERS.get(phone_key)
        if isinstance(mapped, str):
            key = mapped
    record = _DEMO_USERS.get(key)
    if not isinstance(record, dict):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    if not allow_demo:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Demo accounts disabled — set ALLOW_DEMO_ACCOUNTS=true for staging only",
        )
    if record["password"] != password:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    if role and record["role"] != role:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            f"This account is a {record['role']}, not {role}",
        )
    return AuthUser(
        id=record["id"],
        email=record["email"],
        name=record["name"],
        role=record["role"],
        phone=record.get("phone"),
    )


def _verify_firebase_id_token(id_token: str, settings: Settings) -> Mapping[str, Any]:
    if not settings.firestore_project_id:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Firebase authentication is not configured",
        )

    from google.auth import exceptions as google_exceptions
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token as google_id_token

    try:
        return google_id_token.verify_firebase_token(
            id_token,
            google_requests.Request(),
            audience=settings.firestore_project_id,
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid Firebase token") from exc
    except google_exceptions.GoogleAuthError as exc:
        logger.warning("Firebase token verification unavailable: %s", exc)
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Firebase authentication is temporarily unavailable",
        ) from exc


def authenticate_firebase(
    id_token: str,
    requested_role: Role | None = None,
    *,
    settings: Settings | None = None,
    verifier: Callable[[str, Settings], Mapping[str, Any]] | None = None,
) -> AuthUser:
    """Exchange a verified Firebase identity for a My Ride user."""
    settings = settings or get_settings()
    claims = (verifier or _verify_firebase_id_token)(id_token, settings)
    user_id = str(claims.get("sub") or claims.get("user_id") or "").strip()
    if not user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Firebase token has no user ID")

    claimed_role = claims.get("role")
    if claimed_role is not None and claimed_role not in ("rider", "driver", "admin"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Invalid Firebase role claim")

    role: Role = claimed_role or "rider"
    if requested_role and requested_role != role:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            f"This account is a {role}, not {requested_role}",
        )

    email = str(claims.get("email") or "").strip() or None
    phone = str(claims.get("phone_number") or "").strip() or None
    name = str(claims.get("name") or "").strip() or email or phone or "My Ride user"
    return AuthUser(id=user_id, email=email, name=name, role=role, phone=phone)


async def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    settings: Settings = Depends(get_settings),
) -> AuthUser:
    if not creds or not creds.credentials:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Login required")
    return decode_token(creds.credentials, settings)


async def get_websocket_user(
    websocket: WebSocket,
    *roles: Role,
    settings: Settings | None = None,
) -> AuthUser | None:
    await websocket.accept()
    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=5)
        message = json.loads(raw)
        token = message.get("token") if message.get("type") == "auth" else None
    except (asyncio.TimeoutError, json.JSONDecodeError):
        token = None
    if not isinstance(token, str) or not token:
        await websocket.close(code=4401, reason="Login required")
        return None
    try:
        user = decode_token(token, settings or get_settings())
    except HTTPException:
        await websocket.close(code=4401, reason="Invalid token")
        return None
    if roles and user.role not in roles:
        await websocket.close(code=4403, reason="Insufficient role")
        return None
    return user


def require_role(*roles: Role):
    async def _dep(user: AuthUser = Depends(get_current_user)) -> AuthUser:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient role")
        return user

    return _dep


def assert_self_or_admin(user: AuthUser, entity_id: str, *, label: str = "account") -> None:
    """Drivers/riders may only act as themselves; admins may act for anyone."""
    if user.role == "admin":
        return
    if user.id != entity_id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            f"Not allowed for this {label}",
        )


def demo_credentials() -> list[dict[str, str]]:
    return [
        {"role": "rider", "email": "rider@myride.co.za", "password": "ride123"},
        {"role": "driver", "email": "driver@myride.co.za", "password": "drive123"},
        {"role": "admin", "email": "admin@myride.co.za", "password": "admin123"},
    ]
