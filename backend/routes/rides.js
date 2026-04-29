import express from "express";
import { z } from "zod";
import { db } from "../database.js";
import { authRequired, roleRequired } from "../auth.js";

const router = express.Router();

function haversineMeters(aLat, aLng, bLat, bLng) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;

  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);

  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);

  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(s));
}

function estimateFareCents(distanceMeters, vehicleType) {
  const base = 250;
  const perKm = 180;

  const mult = {
    Bike: 0.75,
    Auto: 0.9,
    Mini: 1.0,
    Sedan: 1.25,
  }[vehicleType];

  const km = Math.max(0.5, distanceMeters / 1000);
  return Math.round((base + perKm * km) * mult);
}

function pickNearestDriver({ pickup_lat, pickup_lng, vehicle_type }) {
  const drivers = db
    .prepare(
      `
      SELECT u.id as user_id, u.name, dp.vehicle_type, dp.lat, dp.lng
      FROM driver_profiles dp
      JOIN users u ON u.id = dp.user_id
      WHERE u.role='driver'
        AND dp.approval_status='approved'
        AND dp.online=1
        AND dp.lat IS NOT NULL
        AND dp.lng IS NOT NULL
        AND dp.vehicle_type=?
    `
    )
    .all(vehicle_type);

  if (!drivers.length) return null;

  let best = null;
  let bestD = Infinity;
  for (const d of drivers) {
    const dist = haversineMeters(pickup_lat, pickup_lng, d.lat, d.lng);
    if (dist < bestD) {
      bestD = dist;
      best = d;
    }
  }
  return best;
}

const createRideSchema = z.object({
  pickup_text: z.string().trim().min(3).max(120),
  pickup_lat: z.number().finite(),
  pickup_lng: z.number().finite(),
  dropoff_text: z.string().trim().min(3).max(120),
  dropoff_lat: z.number().finite(),
  dropoff_lng: z.number().finite(),
  vehicle_type: z.enum(["Auto", "Mini", "Sedan", "Bike"]),
});

router.post("/", authRequired, roleRequired("customer"), (req, res) => {
  const parsed = createRideSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "invalid_input", details: parsed.error.flatten() });
  }

  const data = parsed.data;
  const distance = haversineMeters(
    data.pickup_lat,
    data.pickup_lng,
    data.dropoff_lat,
    data.dropoff_lng
  );
  const fare_estimate_cents = estimateFareCents(distance, data.vehicle_type);

  const match = pickNearestDriver(data);
  const io = req.app.locals.io;

  const insertEvent = db.prepare(
    "INSERT INTO ride_events (ride_id, type, message) VALUES (?, ?, ?)"
  );

  const tx = db.transaction(() => {
    let rideId;
    if (match) {
      const info = db
        .prepare(
          `
          INSERT INTO rides (
            customer_id, driver_id, vehicle_type,
            pickup_text, pickup_lat, pickup_lng,
            dropoff_text, dropoff_lat, dropoff_lng,
            status, fare_estimate_cents, payment_status,
            matched_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'matched', ?, 'unpaid', datetime('now'))
        `
        )
        .run(
          req.user.id,
          match.user_id,
          data.vehicle_type,
          data.pickup_text,
          data.pickup_lat,
          data.pickup_lng,
          data.dropoff_text,
          data.dropoff_lat,
          data.dropoff_lng,
          fare_estimate_cents
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
            status, fare_estimate_cents, payment_status
          ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 'requested', ?, 'unpaid')
        `
        )
        .run(
          req.user.id,
          data.vehicle_type,
          data.pickup_text,
          data.pickup_lat,
          data.pickup_lng,
          data.dropoff_text,
          data.dropoff_lat,
          data.dropoff_lng,
          fare_estimate_cents
        );
      rideId = Number(info.lastInsertRowid);
      insertEvent.run(rideId, "ride_requested", "Ride requested; awaiting match");
    }

    return { rideId, matchedDriverId: match?.user_id || null };
  });

  try {
    const out = tx();
    const ride = db.prepare("SELECT * FROM rides WHERE id=?").get(out.rideId);

    io.to(`user:${req.user.id}`).emit("ride:updated", { ride });
    if (out.matchedDriverId) {
      io.to(`driver:${out.matchedDriverId}`).emit("ride:request", { ride });
    }

    return res.status(201).json({ ride });
  } catch {
    return res.status(500).json({ error: "server_error" });
  }
});

router.get("/mine", authRequired, (req, res) => {
  const u = req.user;
  let rides = [];
  if (u.role === "customer") {
    rides = db
      .prepare("SELECT * FROM rides WHERE customer_id=? ORDER BY id DESC LIMIT 50")
      .all(u.id);
  } else if (u.role === "driver") {
    rides = db
      .prepare("SELECT * FROM rides WHERE driver_id=? ORDER BY id DESC LIMIT 50")
      .all(u.id);
  } else {
    return res.status(403).json({ error: "forbidden" });
  }
  return res.json({ rides });
});

router.get("/:id", authRequired, (req, res) => {
  const rideId = Number(req.params.id);
  if (!Number.isFinite(rideId)) {
    return res.status(400).json({ error: "invalid_ride_id" });
  }

  const ride = db.prepare("SELECT * FROM rides WHERE id=?").get(rideId);
  if (!ride) return res.status(404).json({ error: "not_found" });

  const u = req.user;
  const isOwner =
    (u.role === "customer" && ride.customer_id === u.id) ||
    (u.role === "driver" && ride.driver_id === u.id) ||
    u.role === "admin";

  if (!isOwner) return res.status(403).json({ error: "forbidden" });

  const events = db
    .prepare("SELECT * FROM ride_events WHERE ride_id=? ORDER BY id ASC")
    .all(rideId);

  return res.json({ ride, events });
});

router.post("/:id/accept", authRequired, roleRequired("driver"), (req, res) => {
  const rideId = Number(req.params.id);
  if (!Number.isFinite(rideId)) {
    return res.status(400).json({ error: "invalid_ride_id" });
  }

  const u = req.user;

  const profile = db
    .prepare("SELECT approval_status, online FROM driver_profiles WHERE user_id=?")
    .get(u.id);

  if (!profile || profile.approval_status !== "approved") {
    return res.status(403).json({ error: "driver_not_approved" });
  }
  if (!profile.online) return res.status(400).json({ error: "driver_offline" });

  const ride = db.prepare("SELECT * FROM rides WHERE id=?").get(rideId);
  if (!ride) return res.status(404).json({ error: "not_found" });

  if (ride.driver_id !== u.id) {
    return res.status(403).json({ error: "not_assigned_to_you" });
  }

  if (!["matched", "requested"].includes(ride.status)) {
    return res.status(400).json({ error: "invalid_status_transition" });
  }

  db.prepare(
    "UPDATE rides SET status='accepted', accepted_at=datetime('now') WHERE id=?"
  ).run(rideId);

  db.prepare(
    "INSERT INTO ride_events (ride_id, type, message) VALUES (?, 'driver_accepted', ?)"
  ).run(rideId, `Driver ${u.id} accepted`);

  const updated = db.prepare("SELECT * FROM rides WHERE id=?").get(rideId);
  const io = req.app.locals.io;
  io.to(`user:${updated.customer_id}`).emit("ride:updated", { ride: updated });
  io.to(`driver:${u.id}`).emit("ride:updated", { ride: updated });

  return res.json({ ride: updated });
});

router.post("/:id/reject", authRequired, roleRequired("driver"), (req, res) => {
  const rideId = Number(req.params.id);
  if (!Number.isFinite(rideId)) {
    return res.status(400).json({ error: "invalid_ride_id" });
  }

  const u = req.user;
  const ride = db.prepare("SELECT * FROM rides WHERE id=?").get(rideId);
  if (!ride) return res.status(404).json({ error: "not_found" });
  if (ride.driver_id !== u.id) {
    return res.status(403).json({ error: "not_assigned_to_you" });
  }
  if (!["matched", "requested"].includes(ride.status)) {
    return res.status(400).json({ error: "invalid_status_transition" });
  }

  db.prepare(
    "UPDATE rides SET driver_id=NULL, status='requested', matched_at=NULL WHERE id=?"
  ).run(rideId);

  db.prepare(
    "INSERT INTO ride_events (ride_id, type, message) VALUES (?, 'driver_rejected', ?)"
  ).run(rideId, `Driver ${u.id} rejected`);

  const updated = db.prepare("SELECT * FROM rides WHERE id=?").get(rideId);
  const io = req.app.locals.io;
  io.to(`user:${updated.customer_id}`).emit("ride:updated", { ride: updated });
  io.to(`driver:${u.id}`).emit("ride:updated", { ride: updated });

  return res.json({ ride: updated });
});

router.post("/:id/start", authRequired, roleRequired("driver"), (req, res) => {
  const rideId = Number(req.params.id);
  if (!Number.isFinite(rideId)) {
    return res.status(400).json({ error: "invalid_ride_id" });
  }

  const u = req.user;
  const ride = db.prepare("SELECT * FROM rides WHERE id=?").get(rideId);
  if (!ride) return res.status(404).json({ error: "not_found" });
  if (ride.driver_id !== u.id) {
    return res.status(403).json({ error: "not_assigned_to_you" });
  }
  if (ride.status !== "accepted") {
    return res.status(400).json({ error: "invalid_status_transition" });
  }

  db.prepare(
    "UPDATE rides SET status='in_progress', started_at=datetime('now') WHERE id=?"
  ).run(rideId);

  db.prepare(
    "INSERT INTO ride_events (ride_id, type, message) VALUES (?, 'ride_started', 'Ride started')"
  ).run(rideId);

  const updated = db.prepare("SELECT * FROM rides WHERE id=?").get(rideId);
  const io = req.app.locals.io;
  io.to(`user:${updated.customer_id}`).emit("ride:updated", { ride: updated });
  io.to(`driver:${u.id}`).emit("ride:updated", { ride: updated });

  return res.json({ ride: updated });
});

router.post(
  "/:id/request-payment",
  authRequired,
  roleRequired("driver"),
  (req, res) => {
    const rideId = Number(req.params.id);
    if (!Number.isFinite(rideId)) {
      return res.status(400).json({ error: "invalid_ride_id" });
    }

    const u = req.user;
    const ride = db.prepare("SELECT * FROM rides WHERE id=?").get(rideId);
    if (!ride) return res.status(404).json({ error: "not_found" });
    if (ride.driver_id !== u.id) {
      return res.status(403).json({ error: "not_assigned_to_you" });
    }
    if (ride.status !== "in_progress") {
      return res.status(400).json({ error: "invalid_status_transition" });
    }

    db.prepare(
      "UPDATE rides SET payment_status='requires_payment', final_fare_cents=? WHERE id=?"
    ).run(ride.fare_estimate_cents, rideId);

    db.prepare(
      "INSERT INTO ride_events (ride_id, type, message) VALUES (?, 'payment_required', 'Payment required to complete ride')"
    ).run(rideId);

    const updated = db.prepare("SELECT * FROM rides WHERE id=?").get(rideId);
    const io = req.app.locals.io;
    io.to(`user:${updated.customer_id}`).emit("ride:updated", { ride: updated });
    io.to(`driver:${u.id}`).emit("ride:updated", { ride: updated });

    return res.json({ ride: updated });
  }
);

router.post("/:id/complete", authRequired, roleRequired("driver"), (req, res) => {
  const rideId = Number(req.params.id);
  if (!Number.isFinite(rideId)) {
    return res.status(400).json({ error: "invalid_ride_id" });
  }

  const u = req.user;
  const ride = db.prepare("SELECT * FROM rides WHERE id=?").get(rideId);
  if (!ride) return res.status(404).json({ error: "not_found" });
  if (ride.driver_id !== u.id) {
    return res.status(403).json({ error: "not_assigned_to_you" });
  }
  if (ride.status !== "in_progress") {
    return res.status(400).json({ error: "invalid_status_transition" });
  }

  if (ride.payment_status !== "paid") {
    return res.status(402).json({
      error: "payment_required",
      message: "Customer payment is required before completing the ride.",
    });
  }

  db.prepare(
    "UPDATE rides SET status='completed', completed_at=datetime('now') WHERE id=?"
  ).run(rideId);

  db.prepare(
    "INSERT INTO ride_events (ride_id, type, message) VALUES (?, 'ride_completed', 'Ride completed')"
  ).run(rideId);

  db.prepare(
    "UPDATE driver_profiles SET earnings_cents = earnings_cents + ?, updated_at=datetime('now') WHERE user_id=?"
  ).run(ride.final_fare_cents ?? ride.fare_estimate_cents, u.id);

  const updated = db.prepare("SELECT * FROM rides WHERE id=?").get(rideId);
  const io = req.app.locals.io;
  io.to(`user:${updated.customer_id}`).emit("ride:updated", { ride: updated });
  io.to(`driver:${u.id}`).emit("ride:updated", { ride: updated });

  return res.json({ ride: updated });
});

export default router;

