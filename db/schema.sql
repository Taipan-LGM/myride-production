PRAGMA foreign_keys = ON;

-- Users (all roles)
CREATE TABLE IF NOT EXISTS users (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  role              TEXT NOT NULL CHECK (role IN ('customer','driver','admin')),
  external_source   TEXT,
  external_id       TEXT,
  email             TEXT NOT NULL UNIQUE,
  password_hash     TEXT NOT NULL,
  name              TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Driver profile (1:1 with users where role='driver')
CREATE TABLE IF NOT EXISTS driver_profiles (
  user_id           INTEGER PRIMARY KEY,
  license_plate     TEXT NOT NULL,
  vehicle_type      TEXT NOT NULL CHECK (vehicle_type IN ('Car','MPV','Auto','Mini','Sedan','Bike')),
  photo_url         TEXT,
  approval_status   TEXT NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending','approved','rejected')),
  online            INTEGER NOT NULL DEFAULT 0 CHECK (online IN (0,1)),
  lat               REAL,
  lng               REAL,
  earnings_cents    INTEGER NOT NULL DEFAULT 0,
  wallet_address    TEXT,
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Customer profile (optional for future expansion)
CREATE TABLE IF NOT EXISTS customer_profiles (
  user_id           INTEGER PRIMARY KEY,
  phone             TEXT,
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Rides
CREATE TABLE IF NOT EXISTS rides (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id             INTEGER NOT NULL,
  driver_id               INTEGER,
  vehicle_type            TEXT NOT NULL CHECK (vehicle_type IN ('Car','MPV','Auto','Mini','Sedan','Bike')),

  pickup_text             TEXT NOT NULL,
  pickup_lat              REAL NOT NULL,
  pickup_lng              REAL NOT NULL,
  pickup_street_number    TEXT,
  pickup_route            TEXT,

  dropoff_text            TEXT NOT NULL,
  dropoff_lat             REAL NOT NULL,
  dropoff_lng             REAL NOT NULL,
  dropoff_street_number   TEXT,
  dropoff_route           TEXT,

  status                  TEXT NOT NULL CHECK (status IN ('requested','matched','accepted','arriving','in_progress','completed','cancelled')),
  fare_estimate_cents     INTEGER NOT NULL,
  final_fare_cents        INTEGER,

  requested_at            TEXT NOT NULL DEFAULT (datetime('now')),
  matched_at              TEXT,
  accepted_at             TEXT,
  started_at              TEXT,
  completed_at            TEXT,

  payment_status          TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','requires_payment','paid','failed','refunded')),
  stripe_checkout_session_id TEXT,
  stripe_payment_intent_id   TEXT,

  owner_commission_cents    INTEGER,
  driver_earnings_cents     INTEGER,
  payout_status             TEXT NOT NULL DEFAULT 'unpaid',
  zoneless_transfer_id      TEXT,
  zoneless_payout_id        TEXT,

  dispute_note            TEXT,

  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (driver_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_rides_customer_id ON rides(customer_id);
CREATE INDEX IF NOT EXISTS idx_rides_driver_id ON rides(driver_id);
CREATE INDEX IF NOT EXISTS idx_rides_status ON rides(status);

-- Owner / platform revenue split (percent integers, must sum to 100)
CREATE TABLE IF NOT EXISTS platform_settings (
  id INTEGER PRIMARY KEY CHECK (id=1),
  owner_commission_pct INTEGER NOT NULL DEFAULT 51 CHECK (owner_commission_pct >= 0 AND owner_commission_pct <= 100),
  driver_earnings_pct   INTEGER NOT NULL DEFAULT 49 CHECK (driver_earnings_pct >= 0 AND driver_earnings_pct <= 100),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO platform_settings (id) VALUES (1);

-- Ride events (timeline)
CREATE TABLE IF NOT EXISTS ride_events (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  ride_id            INTEGER NOT NULL,
  type              TEXT NOT NULL,
  message           TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ride_events_ride_id ON ride_events(ride_id);

-- Driver location history (used for mock tracking playback / auditing)
CREATE TABLE IF NOT EXISTS driver_locations (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  driver_user_id    INTEGER NOT NULL,
  ride_id           INTEGER,
  lat               REAL NOT NULL,
  lng               REAL NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (driver_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_driver_locations_driver ON driver_locations(driver_user_id);
CREATE INDEX IF NOT EXISTS idx_driver_locations_ride ON driver_locations(ride_id);

-- New driver applications (public form submissions)
CREATE TABLE IF NOT EXISTS driver_applications (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  applicant_name     TEXT NOT NULL,
  applicant_surname  TEXT NOT NULL,
  id_number          TEXT NOT NULL,
  contact_number     TEXT NOT NULL,
  address            TEXT NOT NULL,
  suburb             TEXT NOT NULL,
  city               TEXT NOT NULL,
  postal_code        TEXT NOT NULL,
  driving_experience_years INTEGER NOT NULL,
  id_document_ref    TEXT,
  license_pdp_ref    TEXT,
  comments           TEXT,
  status             TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','reviewed','approved','rejected')),
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_driver_applications_status ON driver_applications(status);

-- Driver QR login challenges (Option B flow)
CREATE TABLE IF NOT EXISTS driver_login_challenges (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  external_source    TEXT NOT NULL,
  external_driver_id TEXT NOT NULL,
  challenge_code     TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','used','expired')),
  expires_at         TEXT NOT NULL,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_driver_login_challenges_status ON driver_login_challenges(status);

