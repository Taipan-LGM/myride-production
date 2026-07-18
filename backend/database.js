import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import dotenv from "dotenv";
import { migrateDriverProfilesRtree } from "./database/rtree.js";

dotenv.config();

const SQLITE_PATH = process.env.SQLITE_PATH || "./mycab.sqlite";

/** Lazy open — do not block HTTP bind if disk/SQLite is slow (Render health). */
let _db = null;

function openDatabase() {
  if (_db) return _db;
  if (!String(SQLITE_PATH).includes("memory")) {
    const dir = path.dirname(path.resolve(SQLITE_PATH));
    // eslint-disable-next-line no-console
    console.log(`[my-ride] ensuring sqlite dir: ${dir}`);
    fs.mkdirSync(dir, { recursive: true });
  }
  // eslint-disable-next-line no-console
  console.log(`[my-ride] opening sqlite: ${SQLITE_PATH}`);
  _db = new Database(SQLITE_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  // eslint-disable-next-line no-console
  console.log("[my-ride] sqlite open ok");
  return _db;
}

export const db = new Proxy(
  {},
  {
    get(_target, prop, _receiver) {
      const real = openDatabase();
      const value = real[prop];
      return typeof value === "function" ? value.bind(real) : value;
    },
  }
);

function hasColumn(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}

function tableSql(name) {
  return (
    db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?")
      .get(name)?.sql || ""
  );
}

function rebuildTableForVehicleTypes(table) {
  // Expand legacy CHECK(vehicle_type IN (...)) to include Car/MPV without losing data.
  // SQLite doesn't support altering CHECK constraints directly, so rebuild table.
  const allowed = "'Car','MPV','Auto','Mini','Sedan','Bike'";

  if (table === "driver_profiles") {
    db.exec(`
      CREATE TABLE IF NOT EXISTS driver_profiles_new (
        user_id           INTEGER PRIMARY KEY,
        license_plate     TEXT NOT NULL,
        vehicle_type      TEXT NOT NULL CHECK (vehicle_type IN (${allowed})),
        photo_url         TEXT,
        approval_status   TEXT NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending','approved','rejected')),
        online            INTEGER NOT NULL DEFAULT 0 CHECK (online IN (0,1)),
        lat               REAL,
        lng               REAL,
        earnings_cents    INTEGER NOT NULL DEFAULT 0,
        updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);

    db.exec(`
      INSERT INTO driver_profiles_new (
        user_id, license_plate, vehicle_type, photo_url, approval_status, online,
        lat, lng, earnings_cents, updated_at
      )
      SELECT
        user_id, license_plate, vehicle_type, photo_url, approval_status, online,
        lat, lng, earnings_cents, updated_at
      FROM driver_profiles;
    `);

    db.exec("DROP TABLE driver_profiles;");
    db.exec("ALTER TABLE driver_profiles_new RENAME TO driver_profiles;");
    return;
  }

  if (table === "rides") {
    db.exec(`
      CREATE TABLE IF NOT EXISTS rides_new (
        id                      INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id             INTEGER NOT NULL,
        driver_id               INTEGER,
        vehicle_type            TEXT NOT NULL CHECK (vehicle_type IN (${allowed})),

        pickup_text             TEXT NOT NULL,
        pickup_lat              REAL NOT NULL,
        pickup_lng              REAL NOT NULL,

        dropoff_text            TEXT NOT NULL,
        dropoff_lat             REAL NOT NULL,
        dropoff_lng             REAL NOT NULL,

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

        dispute_note            TEXT,

        FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE RESTRICT,
        FOREIGN KEY (driver_id) REFERENCES users(id) ON DELETE SET NULL
      );
    `);

    db.exec(`
      INSERT INTO rides_new (
        id, customer_id, driver_id, vehicle_type,
        pickup_text, pickup_lat, pickup_lng,
        dropoff_text, dropoff_lat, dropoff_lng,
        status, fare_estimate_cents, final_fare_cents,
        requested_at, matched_at, accepted_at, started_at, completed_at,
        payment_status, stripe_checkout_session_id, stripe_payment_intent_id,
        dispute_note
      )
      SELECT
        id, customer_id, driver_id, vehicle_type,
        pickup_text, pickup_lat, pickup_lng,
        dropoff_text, dropoff_lat, dropoff_lng,
        status, fare_estimate_cents, final_fare_cents,
        requested_at, matched_at, accepted_at, started_at, completed_at,
        payment_status, stripe_checkout_session_id, stripe_payment_intent_id,
        dispute_note
      FROM rides;
    `);

    db.exec("DROP TABLE rides;");
    db.exec("ALTER TABLE rides_new RENAME TO rides;");

    // Recreate indexes (IF NOT EXISTS so it's safe)
    db.exec("CREATE INDEX IF NOT EXISTS idx_rides_customer_id ON rides(customer_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_rides_driver_id ON rides(driver_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_rides_status ON rides(status)");
    return;
  }
}

function migrate() {
  // Add external identity columns if this DB was created before they existed
  if (hasColumn("users", "external_source") === false) {
    db.exec("ALTER TABLE users ADD COLUMN external_source TEXT");
  }
  if (hasColumn("users", "external_id") === false) {
    db.exec("ALTER TABLE users ADD COLUMN external_id TEXT");
  }

  // Ensure unique index exists (no-op if present)
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_external ON users(external_source, external_id)"
  );

  const dpSql = tableSql("driver_profiles");
  if (dpSql.includes("vehicle_type") && dpSql.includes("'Auto'") && !dpSql.includes("'Car'")) {
    db.transaction(() => rebuildTableForVehicleTypes("driver_profiles"))();
  }

  const ridesSql = tableSql("rides");
  if (ridesSql.includes("vehicle_type") && ridesSql.includes("'Auto'") && !ridesSql.includes("'Car'")) {
    db.transaction(() => rebuildTableForVehicleTypes("rides"))();
  }

  // Address components (street number + route) for dispatch/billing.
  if (hasColumn("rides", "pickup_street_number") === false) {
    db.exec("ALTER TABLE rides ADD COLUMN pickup_street_number TEXT");
  }
  if (hasColumn("rides", "pickup_route") === false) {
    db.exec("ALTER TABLE rides ADD COLUMN pickup_route TEXT");
  }
  if (hasColumn("rides", "dropoff_street_number") === false) {
    db.exec("ALTER TABLE rides ADD COLUMN dropoff_street_number TEXT");
  }
  if (hasColumn("rides", "dropoff_route") === false) {
    db.exec("ALTER TABLE rides ADD COLUMN dropoff_route TEXT");
  }

  // Platform profit split settings (owner/driver) — stored as integers 0..100.
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_settings (
      id INTEGER PRIMARY KEY CHECK (id=1),
      owner_commission_pct INTEGER NOT NULL DEFAULT 51 CHECK (owner_commission_pct >= 0 AND owner_commission_pct <= 100),
      driver_earnings_pct   INTEGER NOT NULL DEFAULT 49 CHECK (driver_earnings_pct >= 0 AND driver_earnings_pct <= 100),
      updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec("INSERT OR IGNORE INTO platform_settings (id) VALUES (1);");

  // Driver payout identity (Solana wallet address).
  if (hasColumn("driver_profiles", "wallet_address") === false) {
    db.exec("ALTER TABLE driver_profiles ADD COLUMN wallet_address TEXT");
  }

  // Ride payout tracking + profit split amounts (cents).
  if (hasColumn("rides", "owner_commission_cents") === false) {
    db.exec("ALTER TABLE rides ADD COLUMN owner_commission_cents INTEGER");
  }
  if (hasColumn("rides", "driver_earnings_cents") === false) {
    db.exec("ALTER TABLE rides ADD COLUMN driver_earnings_cents INTEGER");
  }
  if (hasColumn("rides", "payout_status") === false) {
    db.exec(
      "ALTER TABLE rides ADD COLUMN payout_status TEXT NOT NULL DEFAULT 'unpaid'"
    );
  }
  if (hasColumn("rides", "zoneless_transfer_id") === false) {
    db.exec("ALTER TABLE rides ADD COLUMN zoneless_transfer_id TEXT");
  }
  if (hasColumn("rides", "zoneless_payout_id") === false) {
    db.exec("ALTER TABLE rides ADD COLUMN zoneless_payout_id TEXT");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY CHECK (id=1),
      country TEXT,
      currency TEXT
    );
  `);

  // Legacy app_settings rows might be missing columns if created earlier.
  if (hasColumn("app_settings", "province") === false) {
    db.exec("ALTER TABLE app_settings ADD COLUMN province TEXT");
  }
  if (hasColumn("app_settings", "city") === false) {
    db.exec("ALTER TABLE app_settings ADD COLUMN city TEXT");
  }
  if (hasColumn("app_settings", "geocode_za_only") === false) {
    db.exec(
      "ALTER TABLE app_settings ADD COLUMN geocode_za_only INTEGER NOT NULL DEFAULT 0 CHECK (geocode_za_only IN (0,1))"
    );
  }

  db.exec(`
    INSERT OR IGNORE INTO app_settings (id, country, currency)
    VALUES (1, 'ZA', 'ZAR');
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS failed_address_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_input TEXT NOT NULL DEFAULT '',
      google_prediction TEXT NOT NULL DEFAULT '',
      missing_reason TEXT NOT NULL DEFAULT 'street_number',
      timestamp INTEGER NOT NULL
    );
  `);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_failed_address_attempts_ts ON failed_address_attempts(timestamp)"
  );

  if (hasColumn("app_settings", "rand_per_km") === false) {
    db.exec(
      "ALTER TABLE app_settings ADD COLUMN rand_per_km REAL NOT NULL DEFAULT 12"
    );
  }
  if (hasColumn("app_settings", "address_suggest_debounce_ms") === false) {
    db.exec(
      "ALTER TABLE app_settings ADD COLUMN address_suggest_debounce_ms INTEGER NOT NULL DEFAULT 55"
    );
  }
  if (hasColumn("app_settings", "fare_distance_source") === false) {
    db.exec(
      "ALTER TABLE app_settings ADD COLUMN fare_distance_source TEXT NOT NULL DEFAULT 'osrm'"
    );
  }
  if (hasColumn("app_settings", "carttrack_api_base_url") === false) {
    db.exec("ALTER TABLE app_settings ADD COLUMN carttrack_api_base_url TEXT");
  }
  if (hasColumn("rides", "distance_km") === false) {
    db.exec("ALTER TABLE rides ADD COLUMN distance_km REAL");
  }
  if (hasColumn("rides", "payment_method") === false) {
    db.exec(
      "ALTER TABLE rides ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash','card'))"
    );
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS driver_shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      driver_user_id INTEGER NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT,
      total_km REAL NOT NULL DEFAULT 0,
      total_cash_fare_cents INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (driver_user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_driver_shifts_driver ON driver_shifts(driver_user_id)"
  );

  // INF-001: performance indexes for nearby drivers + active ride lookups
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_dp_online_loc ON driver_profiles(online, lat, lng) WHERE online = 1"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_rides_driver_status ON rides(driver_id, status)"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_rides_customer_status ON rides(customer_id, status)"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_driver_locations_driver_time ON driver_locations(driver_user_id, created_at DESC)"
  );

  migrateDriverProfilesRtree();

  migrateStaffRolesAndChallenges();
}

const OFFICE_ROLE_CHECK =
  "role IN ('customer','driver','admin','operator','supervisor','manager')";

function migrateStaffRolesAndChallenges() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS staff_login_challenges (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      external_source    TEXT NOT NULL,
      external_staff_id  TEXT NOT NULL,
      challenge_code     TEXT NOT NULL,
      status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','used','expired')),
      expires_at         TEXT NOT NULL,
      created_at         TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_staff_login_challenges_status ON staff_login_challenges(status)"
  );

  const usersSql = tableSql("users");
  if (usersSql.includes("operator")) return;

  const fkWasOn = db.pragma("foreign_keys", { simple: true });
  db.pragma("foreign_keys = OFF");

  try {
    db.transaction(() => {
      db.exec(`
      CREATE TABLE users_role_migrate (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        role              TEXT NOT NULL CHECK (${OFFICE_ROLE_CHECK}),
        external_source   TEXT,
        external_id       TEXT,
        email             TEXT NOT NULL UNIQUE,
        password_hash     TEXT NOT NULL,
        name              TEXT NOT NULL,
        created_at        TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
      db.exec(`
      INSERT INTO users_role_migrate (
        id, role, external_source, external_id, email, password_hash, name, created_at
      )
      SELECT id, role, external_source, external_id, email, password_hash, name, created_at
      FROM users;
    `);
      db.exec("DROP TABLE users;");
      db.exec("ALTER TABLE users_role_migrate RENAME TO users;");
      db.exec(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_external ON users(external_source, external_id)"
      );
    })();
  } finally {
    if (fkWasOn) db.pragma("foreign_keys = ON");
  }
}

export function initDatabase(schemaSql) {
  db.exec(schemaSql);
  migrate();
}

