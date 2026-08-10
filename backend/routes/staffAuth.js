import express from "express";
import { z } from "zod";
import { db } from "../database.js";
import { signToken } from "../auth.js";
import { externalStaffIdSchema, STAFF_ROLES } from "../utils/staffQr.js";

const router = express.Router();

const EXTERNAL_SOURCE = "myride_staff";

const requestSchema = z.object({
  external_staff_id: externalStaffIdSchema,
});

function randomDigits(len) {
  let out = "";
  for (let i = 0; i < len; i++) out += String(Math.floor(Math.random() * 10));
  return out;
}

function staffUserForExternalId(external_staff_id) {
  const placeholders = STAFF_ROLES.map(() => "?").join(",");
  return db
    .prepare(
      `
      SELECT id, role, email, name
      FROM users
      WHERE external_source=? AND external_id=? AND role IN (${placeholders})
    `
    )
    .get(EXTERNAL_SOURCE, external_staff_id, ...STAFF_ROLES);
}

router.get("/challenge/:id", (req, res) => {
  const challenge_id = Number(req.params.id);
  if (!Number.isFinite(challenge_id) || challenge_id <= 0) {
    return res.status(400).json({ error: "invalid_challenge_id" });
  }

  const row = db
    .prepare(
      `
      SELECT id, status, expires_at, external_staff_id
      FROM staff_login_challenges
      WHERE id=? AND external_source=?
    `
    )
    .get(challenge_id, EXTERNAL_SOURCE);

  if (!row) return res.status(404).json({ error: "challenge_not_found" });

  const expired = db
    .prepare("SELECT datetime('now') > ? as expired")
    .get(row.expires_at).expired;

  if (expired && row.status === "pending") {
    db.prepare("UPDATE staff_login_challenges SET status='expired' WHERE id=?").run(row.id);
    row.status = "expired";
  }

  return res.json({
    challenge_id: row.id,
    status: row.status,
    expires_at: row.expires_at,
    external_staff_id: row.external_staff_id,
  });
});

router.post("/request-challenge", (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "invalid_input", details: parsed.error.flatten() });
  }

  const external_staff_id = parsed.data.external_staff_id;
  const staffUser = staffUserForExternalId(external_staff_id);
  if (!staffUser) {
    return res.status(404).json({ error: "staff_card_not_registered" });
  }

  const challenge_code = randomDigits(6);
  const expiresAt = db
    .prepare("SELECT datetime('now', '+3 minutes') as ts")
    .get().ts;

  const info = db
    .prepare(
      `
      INSERT INTO staff_login_challenges (
        external_source, external_staff_id, challenge_code, status, expires_at
      ) VALUES (?, ?, ?, 'pending', ?)
    `
    )
    .run(EXTERNAL_SOURCE, external_staff_id, challenge_code, expiresAt);

  const challenge_id = Number(info.lastInsertRowid);

  const autoConfirm =
    process.env.STAFF_QR_AUTO_CONFIRM === "1" ||
    (process.env.NODE_ENV !== "production" && process.env.STAFF_QR_AUTO_CONFIRM !== "0");

  if (autoConfirm) {
    db.prepare("UPDATE staff_login_challenges SET status='confirmed' WHERE id=?").run(
      challenge_id
    );
  }

  return res.status(201).json({
    ok: true,
    challenge_id,
    expires_at: expiresAt,
    auto_confirmed: autoConfirm,
    message: autoConfirm
      ? "Login approved. Tap Complete Login on this device."
      : "Challenge requested. An admin must approve this staff login before you can continue.",
  });
});

const confirmSchema = z.object({
  challenge_id: z.number().int().positive(),
  external_staff_id: externalStaffIdSchema,
});

router.post("/complete", (req, res) => {
  const parsed = confirmSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "invalid_input", details: parsed.error.flatten() });
  }

  const { challenge_id, external_staff_id } = parsed.data;
  const row = db
    .prepare(
      `
      SELECT id, status, expires_at
      FROM staff_login_challenges
      WHERE id=? AND external_source=? AND external_staff_id=?
    `
    )
    .get(challenge_id, EXTERNAL_SOURCE, external_staff_id);

  if (!row) return res.status(404).json({ error: "challenge_not_found" });

  const expired = db
    .prepare("SELECT datetime('now') > ? as expired")
    .get(row.expires_at).expired;

  if (expired) {
    db.prepare("UPDATE staff_login_challenges SET status='expired' WHERE id=?").run(row.id);
    return res.status(400).json({ error: "challenge_expired" });
  }

  if (row.status !== "confirmed") {
    return res.status(403).json({ error: "challenge_not_confirmed" });
  }

  const user = staffUserForExternalId(external_staff_id);
  if (!user) return res.status(404).json({ error: "staff_not_found" });

  db.prepare("UPDATE staff_login_challenges SET status='used' WHERE id=?").run(row.id);

  const token = signToken(user);
  return res.json({ token, user });
});

export default router;
