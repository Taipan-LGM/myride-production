import { db } from "../database.js";
import { logger } from "../lib/logger.js";
import { resolveFareDistanceMeters } from "../services/fareDistanceService.js";
import { haversineMeters } from "../services/haversine.js";
import { findNearbyDrivers, pickNearestDriver } from "../services/nearbyDriversService.js";
import {
  emitRideCancelled,
  emitRideMatched,
  emitRideRequestToDriver,
  emitRideUpdated,
} from "../services/rideSocketService.js";
import { mapVehicleTypeForRide } from "../utils/vehicleTypes.js";

export { findNearbyDrivers };

const ACTIVE_STATUSES = ["matched", "accepted", "arriving", "in_progress"];

export class RideActionError extends Error {
  constructor(code, message, httpStatus = 400) {
    super(message);
    this.name = "RideActionError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function getRandPerKm() {
  const row = db.prepare("SELECT rand_per_km FROM app_settings WHERE id=1").get();
  const r = Number(row?.rand_per_km);
  return Number.isFinite(r) && r > 0 ? r : 12;
}

export function fareEstimateCentsFromTripKm(distanceKm) {
  const km = Math.max(0, Number(distanceKm) || 0);
  return Math.round(km * getRandPerKm() * 100);
}

export function splitFareCents(totalCents) {
  const row = db
    .prepare("SELECT owner_commission_pct FROM platform_settings WHERE id=1")
    .get();
  const ownerPct = Number(row?.owner_commission_pct ?? 51);
  const t = Math.max(0, Math.round(Number(totalCents) || 0));
  const owner = Math.min(t, Math.round((t * ownerPct) / 100));
  return { owner_commission_cents: owner, driver_earnings_cents: t - owner };
}

function addRideToOpenShift(driverUserId, distanceKm, cashFareCents) {
  if (!Number.isFinite(driverUserId)) return;
  const open = db
    .prepare(
      "SELECT id FROM driver_shifts WHERE driver_user_id=? AND ended_at IS NULL ORDER BY id DESC LIMIT 1"
    )
    .get(driverUserId);
  if (!open) return;
  const km = Number(distanceKm);
  const cash = Math.max(0, Math.round(Number(cashFareCents) || 0));
  db.prepare(
    "UPDATE driver_shifts SET total_km = total_km + ?, total_cash_fare_cents = total_cash_fare_cents + ? WHERE id=?"
  ).run(Number.isFinite(km) ? km : 0, cash, open.id);
}

function assertDriverApprovedAndOnline(driverUserId) {
  const profile = db
    .prepare("SELECT approval_status, online FROM driver_profiles WHERE user_id=?")
    .get(driverUserId);
  if (!profile || profile.approval_status !== "approved") {
    throw new RideActionError("driver_not_approved", "Driver not approved", 403);
  }
  if (!profile.online) {
    throw new RideActionError("driver_offline", "Driver is offline", 400);
  }
}

function getRideOrThrow(rideId) {
  const id = Number(rideId);
  if (!Number.isFinite(id)) {
    throw new RideActionError("invalid_ride_id", "Invalid ride id", 400);
  }
  const ride = db.prepare("SELECT * FROM rides WHERE id=?").get(id);
  if (!ride) throw new RideActionError("not_found", "Ride not found", 404);
  return ride;
}

function emitRide(io, ride, extra = {}) {
  if (!io || !ride) return;
  emitRideUpdated(io, ride);
  return extra;
}

/** Map Flutter/socket field names to legacy ride create payload. */
export function normalizeCreateRideInput(body = {}) {
  let paymentMethod = body.payment_method || "cash";
  if (paymentMethod === "wallet") paymentMethod = "card";

  const mapped = {
    pickup_text:
      body.pickup_text ||
      body.pickup_address ||
      body.pickup?.address ||
      "",
    pickup_lat: Number(body.pickup_lat ?? body.pickup?.lat),
    pickup_lng: Number(body.pickup_lng ?? body.pickup?.lng),
    dropoff_text:
      body.dropoff_text ||
      body.dropoff_address ||
      body.dropoff?.address ||
      "",
    dropoff_lat: Number(body.dropoff_lat ?? body.dropoff?.lat),
    dropoff_lng: Number(body.dropoff_lng ?? body.dropoff?.lng),
    vehicle_type: mapVehicleTypeForRide(body.vehicle_type || body.vehicleType || "Car"),
    payment_method: paymentMethod,
    pickup_street_number: body.pickup_street_number,
    pickup_route: body.pickup_route,
    dropoff_street_number: body.dropoff_street_number,
    dropoff_route: body.dropoff_route,
  };

  if (
    !mapped.pickup_text ||
    mapped.pickup_text.length < 3 ||
    !mapped.dropoff_text ||
    mapped.dropoff_text.length < 3 ||
    !Number.isFinite(mapped.pickup_lat) ||
    !Number.isFinite(mapped.pickup_lng) ||
    !Number.isFinite(mapped.dropoff_lat) ||
    !Number.isFinite(mapped.dropoff_lng)
  ) {
    throw new RideActionError("invalid_input", "Invalid ride request payload", 400);
  }

  if (!["Car", "MPV", "Bike"].includes(mapped.vehicle_type)) {
    throw new RideActionError(
      "invalid_input",
      "vehicle_type must be Car, MPV, or Bike",
      400
    );
  }

  if (!["cash", "card"].includes(mapped.payment_method)) {
    throw new RideActionError("invalid_input", "payment_method must be cash or card", 400);
  }

  return mapped;
}

export function getActiveRideForUserId(userId, role) {
  if (role === "customer") {
    return db
      .prepare(
        `SELECT * FROM rides WHERE customer_id=? AND status IN (${ACTIVE_STATUSES.map(() => "?").join(",")}) ORDER BY id DESC LIMIT 1`
      )
      .get(userId, ...ACTIVE_STATUSES);
  }
  if (role === "driver") {
    return db
      .prepare(
        `SELECT * FROM rides WHERE driver_id=? AND status IN (${ACTIVE_STATUSES.map(() => "?").join(",")}) ORDER BY id DESC LIMIT 1`
      )
      .get(userId, ...ACTIVE_STATUSES);
  }
  return null;
}

export async function createRide(customerId, body, { io } = {}) {
  const data = normalizeCreateRideInput(body);

  const active = getActiveRideForUserId(customerId, "customer");
  if (active) {
    throw new RideActionError("active_ride_exists", "You already have an active ride", 400);
  }

  const paymentMethod = data.payment_method;
  const initialPaymentStatus = paymentMethod === "card" ? "requires_payment" : "unpaid";

  let distance;
  try {
    distance = await resolveFareDistanceMeters(
      data.pickup_lat,
      data.pickup_lng,
      data.dropoff_lat,
      data.dropoff_lng
    );
  } catch {
    distance = haversineMeters(
      data.pickup_lat,
      data.pickup_lng,
      data.dropoff_lat,
      data.dropoff_lng
    );
  }
  if (!Number.isFinite(distance) || distance < 0) {
    distance = haversineMeters(
      data.pickup_lat,
      data.pickup_lng,
      data.dropoff_lat,
      data.dropoff_lng
    );
  }

  const rawKm = Number(distance) / 1000;
  const distance_km = Number.isFinite(rawKm) ? Math.round(rawKm * 10) / 10 : 0;
  const fare_estimate_cents = fareEstimateCentsFromTripKm(distance_km);
  const split = splitFareCents(fare_estimate_cents);
  const match = pickNearestDriver(data);

  const insertEvent = db.prepare(
    "INSERT INTO ride_events (ride_id, type, message) VALUES (?, ?, ?)"
  );

  const out = db.transaction(() => {
    let rideId;
    if (match) {
      const info = db
        .prepare(
          `
          INSERT INTO rides (
            customer_id, driver_id, vehicle_type,
            pickup_text, pickup_lat, pickup_lng,
            dropoff_text, dropoff_lat, dropoff_lng,
            pickup_street_number, pickup_route,
            dropoff_street_number, dropoff_route,
            owner_commission_cents, driver_earnings_cents,
            status, fare_estimate_cents, payment_status, payment_method, distance_km,
            matched_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'matched', ?, ?, ?, ?, datetime('now'))
        `
        )
        .run(
          customerId,
          match.user_id,
          data.vehicle_type,
          data.pickup_text,
          data.pickup_lat,
          data.pickup_lng,
          data.dropoff_text,
          data.dropoff_lat,
          data.dropoff_lng,
          data.pickup_street_number || null,
          data.pickup_route || null,
          data.dropoff_street_number || null,
          data.dropoff_route || null,
          split.owner_commission_cents,
          split.driver_earnings_cents,
          fare_estimate_cents,
          initialPaymentStatus,
          paymentMethod,
          distance_km
        );
      rideId = Number(info.lastInsertRowid);
      insertEvent.run(rideId, "ride_matched", `Matched with driver ${match.user_id}`);
    } else {
      const info = db
        .prepare(
          `
          INSERT INTO rides (
            customer_id, driver_id, vehicle_type,
            pickup_text, pickup_lat, pickup_lng,
            dropoff_text, dropoff_lat, dropoff_lng,
            pickup_street_number, pickup_route,
            dropoff_street_number, dropoff_route,
            owner_commission_cents, driver_earnings_cents,
            status, fare_estimate_cents, payment_status, payment_method, distance_km
          ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?, ?, ?)
        `
        )
        .run(
          customerId,
          data.vehicle_type,
          data.pickup_text,
          data.pickup_lat,
          data.pickup_lng,
          data.dropoff_text,
          data.dropoff_lat,
          data.dropoff_lng,
          data.pickup_street_number || null,
          data.pickup_route || null,
          data.dropoff_street_number || null,
          data.dropoff_route || null,
          split.owner_commission_cents,
          split.driver_earnings_cents,
          fare_estimate_cents,
          initialPaymentStatus,
          paymentMethod,
          distance_km
        );
      rideId = Number(info.lastInsertRowid);
      insertEvent.run(rideId, "ride_requested", "Ride requested; awaiting match");
    }

    insertEvent.run(
      rideId,
      "payment_method_selected",
      `Payment method: ${paymentMethod}`
    );

    return { rideId, matchedDriverId: match?.user_id || null };
  })();

  const ride = db.prepare("SELECT * FROM rides WHERE id=?").get(out.rideId);
  emitRide(io, ride);
  if (out.matchedDriverId) {
    emitRideRequestToDriver(io, ride, out.matchedDriverId);
    emitRideMatched(io, ride);
  }

  logger.info("Ride created", { rideId: ride.id, customerId, status: ride.status });
  return ride;
}

export function acceptRide(rideId, driverUserId, { io } = {}) {
  assertDriverApprovedAndOnline(driverUserId);
  const ride = getRideOrThrow(rideId);

  if (ride.driver_id !== driverUserId) {
    throw new RideActionError("not_assigned_to_you", "Ride not assigned to you", 403);
  }
  if (!["matched", "requested"].includes(ride.status)) {
    throw new RideActionError("invalid_status_transition", "Invalid status transition", 400);
  }

  db.prepare(
    "UPDATE rides SET status='accepted', accepted_at=datetime('now') WHERE id=?"
  ).run(ride.id);

  db.prepare(
    "INSERT INTO ride_events (ride_id, type, message) VALUES (?, 'driver_accepted', ?)"
  ).run(ride.id, `Driver ${driverUserId} accepted`);

  const updated = db.prepare("SELECT * FROM rides WHERE id=?").get(ride.id);
  emitRide(io, updated);
  emitRideMatched(io, updated);
  return updated;
}

export function rejectRide(rideId, driverUserId, { io } = {}) {
  const ride = getRideOrThrow(rideId);
  if (ride.driver_id !== driverUserId) {
    throw new RideActionError("not_assigned_to_you", "Ride not assigned to you", 403);
  }
  if (!["matched", "requested"].includes(ride.status)) {
    throw new RideActionError("invalid_status_transition", "Invalid status transition", 400);
  }

  db.prepare(
    "UPDATE rides SET driver_id=NULL, status='requested', matched_at=NULL WHERE id=?"
  ).run(ride.id);

  db.prepare(
    "INSERT INTO ride_events (ride_id, type, message) VALUES (?, 'driver_rejected', ?)"
  ).run(ride.id, `Driver ${driverUserId} rejected`);

  const updated = db.prepare("SELECT * FROM rides WHERE id=?").get(ride.id);
  emitRide(io, updated);
  return updated;
}

export function startRide(rideId, driverUserId, { io } = {}) {
  const ride = getRideOrThrow(rideId);
  if (ride.driver_id !== driverUserId) {
    throw new RideActionError("not_assigned_to_you", "Ride not assigned to you", 403);
  }
  if (ride.status !== "accepted") {
    throw new RideActionError("invalid_status_transition", "Invalid status transition", 400);
  }

  db.prepare(
    "UPDATE rides SET status='in_progress', started_at=datetime('now') WHERE id=?"
  ).run(ride.id);

  db.prepare(
    "INSERT INTO ride_events (ride_id, type, message) VALUES (?, 'ride_started', 'Ride started')"
  ).run(ride.id);

  const updated = db.prepare("SELECT * FROM rides WHERE id=?").get(ride.id);
  emitRide(io, updated);
  return updated;
}

export function requestRidePayment(rideId, driverUserId, { io } = {}) {
  const ride = getRideOrThrow(rideId);
  if (ride.driver_id !== driverUserId) {
    throw new RideActionError("not_assigned_to_you", "Ride not assigned to you", 403);
  }
  if (ride.status !== "in_progress") {
    throw new RideActionError("invalid_status_transition", "Invalid status transition", 400);
  }

  const finalCents = ride.fare_estimate_cents;
  const split = splitFareCents(finalCents);
  db.prepare(
    "UPDATE rides SET payment_status='requires_payment', final_fare_cents=?, owner_commission_cents=?, driver_earnings_cents=? WHERE id=?"
  ).run(finalCents, split.owner_commission_cents, split.driver_earnings_cents, ride.id);

  db.prepare(
    "INSERT INTO ride_events (ride_id, type, message) VALUES (?, 'payment_required', 'Payment required to complete ride')"
  ).run(ride.id);

  const updated = db.prepare("SELECT * FROM rides WHERE id=?").get(ride.id);
  emitRide(io, updated);
  return updated;
}

export function completeRide(rideId, driverUserId, { io } = {}) {
  const ride = getRideOrThrow(rideId);
  if (ride.driver_id !== driverUserId) {
    throw new RideActionError("not_assigned_to_you", "Ride not assigned to you", 403);
  }
  if (ride.status !== "in_progress") {
    throw new RideActionError("invalid_status_transition", "Invalid status transition", 400);
  }

  const pmComplete = String(ride.payment_method || "cash");
  if (ride.payment_status !== "paid" && pmComplete !== "cash") {
    throw new RideActionError(
      "payment_required",
      "Customer payment is required before completing the ride.",
      402
    );
  }

  const fareCents = Number(ride.final_fare_cents ?? ride.fare_estimate_cents);
  const splitDone =
    ride.driver_earnings_cents != null && ride.owner_commission_cents != null
      ? {
          owner_commission_cents: ride.owner_commission_cents,
          driver_earnings_cents: ride.driver_earnings_cents,
        }
      : splitFareCents(fareCents);

  db.prepare(
    `UPDATE rides SET 
      status='completed',
      completed_at=datetime('now'),
      payment_status=CASE WHEN COALESCE(payment_method,'cash')='cash' AND COALESCE(payment_status,'')!='paid' THEN 'paid' ELSE payment_status END,
      final_fare_cents=COALESCE(final_fare_cents, fare_estimate_cents),
      owner_commission_cents=?,
      driver_earnings_cents=?
    WHERE id=?`
  ).run(
    splitDone.owner_commission_cents,
    splitDone.driver_earnings_cents,
    ride.id
  );

  db.prepare(
    "INSERT INTO ride_events (ride_id, type, message) VALUES (?, 'ride_completed', 'Ride completed')"
  ).run(ride.id);

  db.prepare(
    "UPDATE driver_profiles SET earnings_cents = earnings_cents + ?, updated_at=datetime('now') WHERE user_id=?"
  ).run(Number(splitDone.driver_earnings_cents), driverUserId);

  const km = Number(ride.distance_km);
  const cashPart = pmComplete === "cash" ? fareCents : 0;
  addRideToOpenShift(driverUserId, km, cashPart);

  const updated = db.prepare("SELECT * FROM rides WHERE id=?").get(ride.id);
  emitRide(io, updated);
  return updated;
}

export function cancelRide(rideId, actor, { reason = null, io } = {}) {
  const ride = getRideOrThrow(rideId);

  const isCustomer = actor.role === "customer" && ride.customer_id === actor.id;
  const isDriver = actor.role === "driver" && ride.driver_id === actor.id;
  if (!isCustomer && !isDriver) {
    throw new RideActionError("forbidden", "Not allowed to cancel this ride", 403);
  }
  if (ride.status === "completed") {
    throw new RideActionError("cannot_cancel_completed", "Cannot cancel completed ride", 400);
  }
  if (ride.status === "cancelled") {
    return ride;
  }

  db.prepare("UPDATE rides SET status='cancelled' WHERE id=?").run(ride.id);

  const who = isCustomer ? "customer" : "driver";
  db.prepare(
    "INSERT INTO ride_events (ride_id, type, message) VALUES (?, 'ride_cancelled', ?)"
  ).run(
    ride.id,
    reason ? `Cancelled by ${who}: ${reason}` : `Cancelled by ${who}`
  );

  const updated = db.prepare("SELECT * FROM rides WHERE id=?").get(ride.id);
  emitRide(io, updated);
  emitRideCancelled(io, updated, reason);
  return updated;
}

export function getRideForUser(rideId, user) {
  const ride = getRideOrThrow(rideId);
  const isOwner =
    (user.role === "customer" && ride.customer_id === user.id) ||
    (user.role === "driver" && ride.driver_id === user.id) ||
    user.role === "admin" ||
    user.role === "operator" ||
    user.role === "supervisor" ||
    user.role === "manager";

  if (!isOwner) {
    throw new RideActionError("forbidden", "Forbidden", 403);
  }

  const events = db
    .prepare("SELECT * FROM ride_events WHERE ride_id=? ORDER BY id ASC")
    .all(ride.id);

  return { ride, events };
}

export function listRidesForUser(user) {
  if (user.role === "customer") {
    return db
      .prepare("SELECT * FROM rides WHERE customer_id=? ORDER BY id DESC LIMIT 50")
      .all(user.id);
  }
  if (user.role === "driver") {
    return db
      .prepare("SELECT * FROM rides WHERE driver_id=? ORDER BY id DESC LIMIT 50")
      .all(user.id);
  }
  throw new RideActionError("forbidden", "Forbidden", 403);
}

export function getRideHistoryForUser(user, { page = 1, limit = 20 } = {}) {
  const offset = (page - 1) * limit;
  let rides;
  let total;

  if (user.role === "customer") {
    rides = db
      .prepare(
        "SELECT * FROM rides WHERE customer_id=? ORDER BY id DESC LIMIT ? OFFSET ?"
      )
      .all(user.id, limit, offset);
    total = db
      .prepare("SELECT COUNT(*) AS count FROM rides WHERE customer_id=?")
      .get(user.id);
  } else if (user.role === "driver") {
    rides = db
      .prepare(
        "SELECT * FROM rides WHERE driver_id=? ORDER BY id DESC LIMIT ? OFFSET ?"
      )
      .all(user.id, limit, offset);
    total = db
      .prepare("SELECT COUNT(*) AS count FROM rides WHERE driver_id=?")
      .get(user.id);
  } else {
    throw new RideActionError("forbidden", "Forbidden", 403);
  }

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
