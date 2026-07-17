import { db } from "../database.js";
import { getActiveRideForDriver } from "../services/rideSocketService.js";

export class DriverActionError extends Error {
  constructor(code, message, httpStatus = 400) {
    super(message);
    this.name = "DriverActionError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/**
 * Parse online intent from socket / HTTP / Flutter payloads.
 * Defaults to offline when status is ambiguous (matches legacy socket handler).
 */
export function parseOnlineFromPayload(payload = {}) {
  if (
    payload.status === "offline" ||
    payload.online === false ||
    payload.online === 0 ||
    payload.is_online === false
  ) {
    return false;
  }
  if (
    payload.online === true ||
    payload.online === 1 ||
    payload.status === "online" ||
    payload.is_online === true
  ) {
    return true;
  }
  return false;
}

/** Map Flutter / FastAPI location body to lat/lng. */
export function normalizeLocationInput(payload = {}) {
  const lat = Number(
    payload.lat ?? payload.location?.lat ?? payload.latitude
  );
  const lng = Number(
    payload.lng ?? payload.location?.lng ?? payload.longitude
  );

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new DriverActionError(
      "invalid_coordinates",
      "Latitude and longitude are required",
      400
    );
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new DriverActionError(
      "invalid_coordinates",
      "Coordinates out of range",
      400
    );
  }

  return {
    lat,
    lng,
    bearing: payload.bearing,
    speed: payload.speed,
  };
}

function assertDriverProfile(driverUserId) {
  const profile = db
    .prepare(
      "SELECT user_id, approval_status, online FROM driver_profiles WHERE user_id=?"
    )
    .get(driverUserId);
  if (!profile) {
    throw new DriverActionError("not_found", "Driver profile not found", 404);
  }
  return profile;
}

/**
 * Toggle driver online/offline and manage shift records.
 * @returns {{ online: boolean, shift_summary?: object }}
 */
export function setDriverOnline(driverUserId, payload = {}) {
  assertDriverProfile(driverUserId);
  const online = parseOnlineFromPayload(payload);

  db.prepare(
    "UPDATE driver_profiles SET online=?, updated_at=datetime('now') WHERE user_id=?"
  ).run(online ? 1 : 0, driverUserId);

  let shiftSummary = null;

  if (online) {
    const existing = db
      .prepare(
        `SELECT id FROM driver_shifts
         WHERE driver_user_id=? AND ended_at IS NULL
         ORDER BY id DESC LIMIT 1`
      )
      .get(driverUserId);
    if (!existing) {
      db.prepare(
        "INSERT INTO driver_shifts (driver_user_id, started_at) VALUES (?, datetime('now'))"
      ).run(driverUserId);
    }
  } else {
    const openShift = db
      .prepare(
        `SELECT id, total_km, total_cash_fare_cents
         FROM driver_shifts
         WHERE driver_user_id=? AND ended_at IS NULL
         ORDER BY id DESC LIMIT 1`
      )
      .get(driverUserId);
    if (openShift) {
      db.prepare(
        "UPDATE driver_shifts SET ended_at=datetime('now') WHERE id=?"
      ).run(openShift.id);
      shiftSummary = {
        shift_id: openShift.id,
        total_km: Number(openShift.total_km) || 0,
        total_cash_fare_cents: Number(openShift.total_cash_fare_cents) || 0,
      };
    }
  }

  return { online, shift_summary: shiftSummary };
}

/**
 * Persist GPS to driver_profiles + driver_locations history.
 * @returns {{ lat: number, lng: number, activeRide: object|null, bearing?: number, speed?: number }}
 */
export function persistDriverLocation(driverUserId, payload = {}) {
  assertDriverProfile(driverUserId);
  const { lat, lng, bearing, speed } = normalizeLocationInput(payload);
  const activeRide = getActiveRideForDriver(driverUserId);
  const rideId = activeRide?.id ?? null;

  db.prepare(
    "UPDATE driver_profiles SET lat=?, lng=?, updated_at=datetime('now') WHERE user_id=?"
  ).run(lat, lng, driverUserId);

  db.prepare(
    "INSERT INTO driver_locations (driver_user_id, ride_id, lat, lng) VALUES (?, ?, ?, ?)"
  ).run(driverUserId, rideId, lat, lng);

  return { lat, lng, activeRide, bearing, speed };
}

export function getDriverProfile(driverUserId) {
  return db
    .prepare(
      `SELECT user_id, license_plate, vehicle_type, photo_url, approval_status,
              online, lat, lng, earnings_cents, wallet_address, updated_at
       FROM driver_profiles WHERE user_id=?`
    )
    .get(driverUserId);
}

/** API-shaped driver profile (legacy schema). */
export function formatDriverProfile(driverUserId) {
  const profile = getDriverProfile(driverUserId);
  if (!profile) return null;

  const user = db
    .prepare("SELECT id, name, email, role FROM users WHERE id=?")
    .get(driverUserId);

  return {
    driver_id: String(profile.user_id),
    user_id: profile.user_id,
    name: user?.name || null,
    email: user?.email || null,
    approval_status: profile.approval_status,
    online: Boolean(profile.online),
    is_available: Boolean(profile.online),
    location:
      profile.lat != null && profile.lng != null
        ? { lat: profile.lat, lng: profile.lng }
        : null,
    vehicle: {
      license_plate: profile.license_plate,
      vehicle_type: profile.vehicle_type,
      photo_url: profile.photo_url,
    },
    earnings_cents: profile.earnings_cents || 0,
    wallet_address: profile.wallet_address,
    last_updated: profile.updated_at,
  };
}

/**
 * Submit driver application (legacy `driver_applications` table).
 */
export function applyDriverApplication(user, body) {
  const pending = db
    .prepare(
      `SELECT id FROM driver_applications
       WHERE contact_number = ? AND status IN ('new', 'reviewed')`
    )
    .get(body.contact_number);

  if (pending) {
    throw new DriverActionError("driver_application_pending", "Application already pending", 400);
  }

  const info = db
    .prepare(
      `
      INSERT INTO driver_applications (
        applicant_name, applicant_surname, id_number, contact_number,
        address, suburb, city, postal_code, driving_experience_years,
        id_document_ref, license_pdp_ref, comments, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')
    `
    )
    .run(
      body.applicant_name,
      body.applicant_surname,
      body.id_number,
      body.contact_number,
      body.address,
      body.suburb,
      body.city,
      body.postal_code,
      body.driving_experience_years ?? body.years_experience ?? 0,
      body.id_document_ref || body.driver_license || null,
      body.license_pdp_ref || null,
      body.comments || null
    );

  return {
    application_id: Number(info.lastInsertRowid),
    status: "new",
    applicant_email: user.email,
  };
}

function periodFilter(period) {
  switch (period) {
    case "week":
      return "datetime(completed_at) >= datetime('now', '-7 days')";
    case "month":
      return "datetime(completed_at) >= datetime('now', '-30 days')";
    case "today":
    default:
      return "date(completed_at) = date('now')";
  }
}

/**
 * Driver earnings summary from completed rides (legacy schema).
 */
export function getDriverEarnings(driverUserId, period = "today") {
  assertDriverProfile(driverUserId);
  const filter = periodFilter(period);

  const row = db
    .prepare(
      `
      SELECT
        COUNT(*) AS rides,
        COALESCE(SUM(final_fare_cents), 0) AS total_cents,
        COALESCE(AVG(final_fare_cents), 0) AS average_cents
      FROM rides
      WHERE driver_id = ?
        AND status = 'completed'
        AND ${filter}
    `
    )
    .get(driverUserId);

  return {
    driver_id: driverUserId,
    period,
    rides: row?.rides || 0,
    total_cents: row?.total_cents || 0,
    average_cents: Math.round(row?.average_cents || 0),
  };
}

/**
 * Paginated driver ride history.
 */
export function getDriverRideHistory(driverUserId, { page = 1, limit = 20 } = {}) {
  assertDriverProfile(driverUserId);
  const offset = (page - 1) * limit;

  const rides = db
    .prepare(
      `
      SELECT
        r.id AS ride_id,
        r.status,
        r.pickup_text,
        r.dropoff_text,
        r.final_fare_cents,
        r.fare_estimate_cents,
        r.payment_status,
        r.requested_at,
        r.started_at,
        r.completed_at,
        u.name AS customer_name,
        u.email AS customer_email
      FROM rides r
      JOIN users u ON u.id = r.customer_id
      WHERE r.driver_id = ?
      ORDER BY r.requested_at DESC
      LIMIT ? OFFSET ?
    `
    )
    .all(driverUserId, limit, offset);

  const total = db
    .prepare("SELECT COUNT(*) AS count FROM rides WHERE driver_id = ?")
    .get(driverUserId);

  return {
    rides,
    pagination: {
      page,
      limit,
      total: total?.count || 0,
      pages: Math.ceil((total?.count || 0) / limit),
    },
  };
}
