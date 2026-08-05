-- My Ride SA production schema (Postgres)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE,
    phone VARCHAR(32) UNIQUE,
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('rider', 'driver', 'admin')),
    password_hash TEXT,
    rating NUMERIC(3,2) DEFAULT 5.0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    passenger_id UUID REFERENCES users(id),
    driver_id UUID REFERENCES users(id),
    status VARCHAR(40) NOT NULL DEFAULT 'requested',
    booking_channel VARCHAR(20) DEFAULT 'app',
    pickup_lat DOUBLE PRECISION,
    pickup_lng DOUBLE PRECISION,
    pickup_address TEXT,
    dropoff_lat DOUBLE PRECISION,
    dropoff_lng DOUBLE PRECISION,
    dropoff_address TEXT,
    fare_cents INT,
    currency VARCHAR(8) DEFAULT 'zar',
    surge_multiplier NUMERIC(4,2) DEFAULT 1.0,
    scheduled_for TIMESTAMPTZ,
    requested_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    payment_status VARCHAR(30) DEFAULT 'pending',
    reconciliation_status VARCHAR(30) DEFAULT 'pending'
);

-- Dual-write event log (string external ids from in-memory/Firestore app)
CREATE TABLE IF NOT EXISTS ride_events (
    id BIGSERIAL PRIMARY KEY,
    external_id TEXT UNIQUE NOT NULL,
    rider_external_id TEXT,
    driver_external_id TEXT,
    status VARCHAR(40) NOT NULL DEFAULT 'requested',
    pickup_lat DOUBLE PRECISION,
    pickup_lng DOUBLE PRECISION,
    pickup_address TEXT,
    dropoff_lat DOUBLE PRECISION,
    dropoff_lng DOUBLE PRECISION,
    dropoff_address TEXT,
    fare_cents INT,
    currency VARCHAR(8) DEFAULT 'zar',
    payment_status VARCHAR(30) DEFAULT 'pending',
    raw JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_ledger (
    id BIGSERIAL PRIMARY KEY,
    idempotency_key TEXT,
    trip_external_id TEXT,
    amount_cents INT NOT NULL,
    kind VARCHAR(40) NOT NULL,
    status VARCHAR(40) NOT NULL,
    external_ref TEXT,
    record JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE payment_ledger ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE payment_ledger ADD COLUMN IF NOT EXISTS record JSONB;

CREATE TABLE IF NOT EXISTS driver_locations (
    driver_external_id TEXT PRIMARY KEY,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    is_online BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform_settings (
    setting_key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rides_passenger ON rides(passenger_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_rides_driver ON rides(driver_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_rides_status ON rides(status);
CREATE INDEX IF NOT EXISTS idx_ride_events_rider ON ride_events(rider_external_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ride_events_status ON ride_events(status);
CREATE INDEX IF NOT EXISTS idx_payment_ledger_trip ON payment_ledger(trip_external_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_ledger_idempotency ON payment_ledger(idempotency_key) WHERE idempotency_key IS NOT NULL;
