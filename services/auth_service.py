import base64
import hashlib
import hmac
import json
import os
import time


class AuthenticationError(ValueError):
    pass


class AuthService:
    def __init__(self, secret=None, token_ttl_seconds=3600):
        configured_secret = secret or os.getenv("MYRIDE_AUTH_SECRET")
        if os.getenv("ENVIRONMENT", "development") == "production" and not configured_secret:
            raise RuntimeError("MYRIDE_AUTH_SECRET is required in production")
        self.secret = (configured_secret or "development-only-change-me").encode("utf-8")
        self.token_ttl_seconds = token_ttl_seconds

    @staticmethod
    def _encode(value):
        return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")

    @staticmethod
    def _decode(value):
        padding = "=" * (-len(value) % 4)
        return base64.urlsafe_b64decode(value + padding)

    def issue_token(self, user_id, role, now=None):
        if role not in {"passenger", "driver", "admin"}:
            raise AuthenticationError("Unsupported role")
        issued_at = int(now if now is not None else time.time())
        payload = self._encode(json.dumps({
            "sub": user_id,
            "role": role,
            "iat": issued_at,
            "exp": issued_at + self.token_ttl_seconds,
        }, separators=(",", ":"), sort_keys=True).encode("utf-8"))
        signature = self._encode(hmac.new(self.secret, payload.encode("ascii"), hashlib.sha256).digest())
        return f"{payload}.{signature}"

    def verify_token(self, token, allowed_roles=None, now=None):
        try:
            payload, signature = token.split(".", 1)
            expected = self._encode(hmac.new(self.secret, payload.encode("ascii"), hashlib.sha256).digest())
            if not hmac.compare_digest(signature, expected):
                raise AuthenticationError("Invalid token signature")
            claims = json.loads(self._decode(payload))
        except (ValueError, TypeError, json.JSONDecodeError) as error:
            if isinstance(error, AuthenticationError):
                raise
            raise AuthenticationError("Malformed access token") from error
        current_time = int(now if now is not None else time.time())
        if claims.get("exp", 0) <= current_time:
            raise AuthenticationError("Access token expired")
        if allowed_roles and claims.get("role") not in set(allowed_roles):
            raise AuthenticationError("Insufficient role")
        return claims

    def authenticate(self, role, password):
        development = os.getenv("ENVIRONMENT", "development") == "development"
        credentials = {
            "passenger": os.getenv("MYRIDE_PASSENGER_PASSWORD") or ("ride-demo" if development else None),
            "driver": os.getenv("MYRIDE_DRIVER_PASSWORD") or ("drive-demo" if development else None),
            "admin": os.getenv("MYRIDE_ADMIN_PASSWORD") or ("ops-demo" if development else None),
        }
        expected = credentials.get(role)
        if not expected or not hmac.compare_digest(password, expected):
            raise AuthenticationError("Invalid credentials")
        user_ids = {"passenger": "demo-rider", "driver": "drv_thabo", "admin": "admin-operator"}
        return self.issue_token(user_ids[role], role)