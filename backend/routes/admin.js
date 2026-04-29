import express from "express";
import { z } from "zod";
import { db } from "../database.js";
import { authRequired, roleRequired } from "../auth.js";
import { externalDriverIdSchema } from "../utils/logicline.js";

const router = express.Router();

router.use(authRequired, roleRequired("admin"));

router.get("/users", (_req, res) => {
  const users = db
    .prepare("SELECT id, role, email, name, created_at FROM users ORDER BY id DESC")
    .all();
  res.json({ users });
});

router.get("/drivers", (_req, res) => {
  const drivers = db
    .prepare(
      `
      SELECT
        u.id, u.email, u.name, u.created_at,
        dp.license_plate, dp.vehicle_type, dp.photo_url,
        dp.approval_status, dp.online, dp.lat, dp.lng, dp.earnings_cents, dp.updated_at
      FROM users u
      JOIN driver_profiles dp ON dp.user_id = u.id
      WHERE u.role='driver'
      ORDER BY u.id DESC
    `
    )
    .all();
  res.json({ drivers });
});

const approveSchema = z.object({
  status: z.enum(["approved", "rejected"]),
});

router.post("/drivers/:id/approval", (req, res) => {
  const driverId = Number(req.params.id);
  if (!Number.isFinite(driverId)) {
    return res.status(400).json({ error: "invalid_driver_id" });
  }

  const parsed = approveSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "invalid_input", details: parsed.error.flatten() });
  }

  const existing = db
    .prepare("SELECT user_id FROM driver_profiles WHERE user_id=?")
    .get(driverId);
  if (!existing) return res.status(404).json({ error: "driver_not_found" });

  db.prepare(
    "UPDATE driver_profiles SET approval_status=?, updated_at=datetime('now') WHERE user_id=?"
  ).run(parsed.data.status, driverId);

  res.json({ ok: true });
});

router.get("/rides", (_req, res) => {
  const rides = db
    .prepare(
      `
      SELECT r.*,
        cu.email as customer_email, cu.name as customer_name,
        du.email as driver_email, du.name as driver_name
      FROM rides r
      JOIN users cu ON cu.id = r.customer_id
      LEFT JOIN users du ON du.id = r.driver_id
      ORDER BY r.id DESC
      LIMIT 200
    `
    )
    .all();
  res.json({ rides });
});

router.post("/rides/:id/dispute", (req, res) => {
  const rideId = Number(req.params.id);
  if (!Number.isFinite(rideId)) {
    return res.status(400).json({ error: "invalid_ride_id" });
  }

  const note = String(req.body?.note || "").trim().slice(0, 600);
  db.prepare("UPDATE rides SET dispute_note=? WHERE id=?").run(note || null, rideId);
  db.prepare(
    "INSERT INTO ride_events (ride_id, type, message) VALUES (?, 'dispute_updated', ?)"
  ).run(rideId, note ? `Dispute note set: ${note}` : "Dispute note cleared");

  res.json({ ok: true });
});

router.get("/analytics", (_req, res) => {
  const ridesPerDay = db
    .prepare(
      `
      SELECT substr(requested_at, 1, 10) as day, COUNT(*) as rides
      FROM rides
      GROUP BY day
      ORDER BY day DESC
      LIMIT 30
    `
    )
    .all();

  const revenuePerDay = db
    .prepare(
      `
      SELECT substr(completed_at, 1, 10) as day,
             SUM(COALESCE(final_fare_cents, fare_estimate_cents)) as revenue_cents
      FROM rides
      WHERE status='completed' AND payment_status='paid' AND completed_at IS NOT NULL
      GROUP BY day
      ORDER BY day DESC
      LIMIT 30
    `
    )
    .all();

  const totals = db
    .prepare(
      `
      SELECT
        (SELECT COUNT(*) FROM users) as total_users,
        (SELECT COUNT(*) FROM users WHERE role='customer') as total_customers,
        (SELECT COUNT(*) FROM users WHERE role='driver') as total_drivers,
        (SELECT COUNT(*) FROM rides) as total_rides,
        (SELECT COUNT(*) FROM rides WHERE status='completed') as completed_rides,
        (SELECT COALESCE(SUM(COALESCE(final_fare_cents, fare_estimate_cents)), 0)
         FROM rides
         WHERE payment_status='paid' AND status='completed') as total_revenue_cents
    `
    )
    .get();

  res.json({ totals, ridesPerDay, revenuePerDay });
});

router.post("/seed-drivers", (_req, res) => {
  const cityLat = 40.7128;
  const cityLng = -74.006;
  const vehicleTypes = ["Auto", "Mini", "Sedan", "Bike"];
  const count = 8;

  const insertUser = db.prepare(
    "INSERT INTO users (role, email, password_hash, name) VALUES ('driver', ?, ?, ?)"
  );
  const insertProfile = db.prepare(
    "INSERT INTO driver_profiles (user_id, license_plate, vehicle_type, photo_url, approval_status, online, lat, lng) VALUES (?, ?, ?, ?, 'approved', 1, ?, ?)"
  );

  // bcrypt hash for password "Driver12345!" cost 10 (same as seed script)
  const passwordHash =
    "$2a$10$uSg3qV7Y2mKxj8hX2v7XzO5l4v8p2b2xWg3qY4d1yIhH1fJm0b2ZK";

  const tx = db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const email = `seed.driver${Date.now()}_${i}@myride.local`.toLowerCase();
      const name = `Seed Driver ${i + 1}`;
      const plate = `MYRIDE-${100 + i}`;
      const vt = vehicleTypes[i % vehicleTypes.length];

      const lat = cityLat + (Math.random() - 0.5) * 0.08;
      const lng = cityLng + (Math.random() - 0.5) * 0.08;

      const info = insertUser.run(email, passwordHash, name);
      const userId = Number(info.lastInsertRowid);
      insertProfile.run(userId, plate, vt, null, lat, lng);
    }
  });

  tx();
  res.json({ ok: true, seeded: count });
});

router.get("/applications", (_req, res) => {
  const applications = db
    .prepare(
      `
      SELECT *
      FROM driver_applications
      ORDER BY id DESC
      LIMIT 200
    `
    )
    .all();
  res.json({ applications });
});

const applicationStatusSchema = z.object({
  status: z.enum(["new", "reviewed", "approved", "rejected"]),
});

router.patch("/applications/:id/status", (req, res) => {
  const applicationId = Number(req.params.id);
  if (!Number.isFinite(applicationId)) {
    return res.status(400).json({ error: "invalid_application_id" });
  }

  const parsed = applicationStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "invalid_input", details: parsed.error.flatten() });
  }

  const existing = db
    .prepare("SELECT id FROM driver_applications WHERE id=?")
    .get(applicationId);
  if (!existing) return res.status(404).json({ error: "application_not_found" });

  db.prepare("UPDATE driver_applications SET status=? WHERE id=?").run(
    parsed.data.status,
    applicationId
  );

  const updated = db.prepare("SELECT * FROM driver_applications WHERE id=?").get(applicationId);
  res.json({ ok: true, application: updated });
});

// --- Logicline integration helpers (dev/staging) ---
// Confirms a pending driver QR login challenge (Option B) as if Logicline approved it.
const logiclineConfirmSchema = z.object({
  challenge_id: z.number().int().positive(),
  external_driver_id: externalDriverIdSchema,
});

router.post("/logicline/confirm-challenge", (req, res) => {
  const parsed = logiclineConfirmSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "invalid_input", details: parsed.error.flatten() });
  }

  const { challenge_id, external_driver_id } = parsed.data;
  const EXTERNAL_SOURCE = "logicline";

  const row = db
    .prepare(
      `
      SELECT id, status, expires_at
      FROM driver_login_challenges
      WHERE id=? AND external_source=? AND external_driver_id=?
    `
    )
    .get(challenge_id, EXTERNAL_SOURCE, external_driver_id);

  if (!row) return res.status(404).json({ error: "challenge_not_found" });

  const expired = db
    .prepare("SELECT datetime('now') > ? as expired")
    .get(row.expires_at).expired;

  if (expired) {
    db.prepare("UPDATE driver_login_challenges SET status='expired' WHERE id=?").run(row.id);
    return res.status(400).json({ error: "challenge_expired" });
  }

  if (row.status !== "pending") {
    return res.status(400).json({ error: "invalid_challenge_status" });
  }

  db.prepare("UPDATE driver_login_challenges SET status='confirmed' WHERE id=?").run(row.id);
  return res.json({ ok: true });
});

export default router;

