from __future__ import annotations

import os
from functools import lru_cache

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "My Ride API"
    debug: bool = False
    log_level: str = "info"
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    cors_origins: str = "https://myride-production.onrender.com"

    # OpenAI
    openai_api_key: str = ""
    openai_model: str = "gpt-4o"

    # Twilio
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_phone_number: str = ""
    twilio_whatsapp_number: str = "whatsapp:+14155238886"
    # Public SA booking numbers shown in hub /channels (override when Twilio live)
    public_booking_phone: str = "+278000MYRIDE"
    public_whatsapp_number: str = "whatsapp:+278000MYRIDE"
    public_base_url: str = "http://localhost:8000"

    # Stripe (hybrid: prefer live key only when ENVIRONMENT=production)
    environment: str = "development"
    stripe_secret_key: str = ""
    stripe_test_secret_key: str = ""
    stripe_live_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_currency: str = "zar"
    stripe_connect_return_url: str = ""
    stripe_connect_refresh_url: str = ""
    stripe_connect_country: str = "ZA"
    stripe_connect_za_approved: bool = False

    # Firestore / GCP
    google_application_credentials: str = ""
    firestore_project_id: str = ""
    use_firestore_emulator: bool = False
    firestore_emulator_host: str = "localhost:8080"

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # Cartrack fleet telemetry (server-side admin overlay only)
    cartrack_enabled: bool = False
    cartrack_base_url: str = "https://fleetapi-za.cartrack.com/rest"
    cartrack_username: str = ""
    cartrack_api_key: str = ""

    # Driver remuneration (snapshotted onto each trip at creation)
    default_driver_share_bps: int = Field(default=8500, ge=0, le=10000)

    # Geofire defaults (km)
    driver_search_radius_km: float = 5.0
    driver_search_limit: int = 10

    # Auth
    jwt_secret: str = "changed-me-in-production"
    # Demo rider/driver/admin logins — disable before public traffic
    allow_demo_accounts: bool = True
    # Admin-only Phase 0 bulk seed (/admin/phase0/*) — keep true on staging
    allow_phase0_seed: bool = False

    @field_validator("jwt_secret")
    @classmethod
    def _validate_jwt_secret(cls, v: str) -> str:
        v = v.strip()
        if not v or v == "changed-me-in-production":
            raise ValueError(
                "JWT_SECRET must be set to a strong secret (≥32 chars). "
                "Generate one: openssl rand -hex 32"
            )
        if len(v) < 32:
            raise ValueError(
                f"JWT_SECRET too short ({len(v)} chars) — must be ≥32 characters"
            )
        return v

    # Optional Postgres (schema: database/init.sql).
    # Default: dual-write mirror. Set USE_POSTGRES_PRIMARY=true to make Postgres
    # the source of truth for trips (Part 11).
    database_url: str = ""
    use_postgres_primary: bool = False

    @model_validator(mode="after")
    def _derive_public_urls_for_paas(self) -> Settings:
        """Render injects RENDER_EXTERNAL_URL — use it so prod boot works before manual CORS."""
        if self.environment != "production":
            return self
        render_url = (os.environ.get("RENDER_EXTERNAL_URL") or "").strip().rstrip("/")
        pub = (self.public_base_url or "").strip().rstrip("/")
        # Prefer HTTPS Render URL over localhost / empty defaults from .env.example
        if render_url.startswith("https://") and not pub.startswith("https://"):
            object.__setattr__(self, "public_base_url", render_url)
            pub = render_url
        if self.cors_origins.strip() in ("", "*") and pub.startswith("https://"):
            object.__setattr__(self, "cors_origins", pub)
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
