import express from "express";
import { z } from "zod";
import { db } from "../database.js";
import { hashPassword, signToken } from "../auth.js";
import { externalDriverIdSchema } from "../utils/logicline.js";

const router = express.Router();

const EXTERNAL_SOURCE = "logicline";

const requestSchema = z.object({
  external_driver_id: externalDriverIdSchema,
});

function randomDigits(len) {
  let out = "";
  for (let i = 0; i < len; i++) out += String(Math.floor(Math.random() * 10));
  return out;
}

router.post("/request-challenge", (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "invalid_input", details: parsed.error.flatten() });
  }

  const external_driver_id = parsed.data.external_driver_id;
  const challenge_code = randomDigits(6);

  // 3 minute expiry
  const expiresAt = db
    .prepare("SELECT datetime('now', '+3 minutes') as ts")
    .get().ts;

  const info = db
    .prepare(
      `
      INSERT INTO driver_login_challenges (
        external_source, external_driver_id, challenge_code, status, expires_at
      ) VALUES (?, ?, ?, 'pending', ?)
    `
    )
    .run(EXTERNAL_SOURCE, external_driver_id, challenge_code, expiresAt);

  // In production: My Ride calls Logicline server-to-server (API key) to request a challenge.
  // The challenge secret/code must NOT be shown to the driver in My Ride.
  return res.status(201).json({
    ok: true,
    challenge_id: Number(info.lastInsertRowid),
    expires_at: expiresAt,
    message:
      "Challenge requested. Confirm this login request inside Logicline (or via admin tools during integration testing).",
  });
});

const confirmSchema = z.object({
  challenge_id: z.number().int().positive(),
  external_driver_id: externalDriverIdSchema,
});

// Demo-only: simulate Logicline confirmation (disabled unless explicitly enabled)
router.post("/mock-confirm", (req, res) => {
  const allow =
    process.env.ALLOW_MOCK_LOGICLINE === "1" || process.env.NODE_ENV !== "production";
  if (!allow) return res.status(404).json({ error: "not_found" });

  const parsed = confirmSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "invalid_input", details: parsed.error.flatten() });
  }

  const row = db
    .prepare(
      `
      SELECT id, status, expires_at
      FROM driver_login_challenges
      WHERE id=? AND external_source=? AND external_driver_id=?
    `
    )
    .get(parsed.data.challenge_id, EXTERNAL_SOURCE, parsed.data.external_driver_id);

  if (!row) return res.status(404).json({ error: "challenge_not_found" });

  const expired = db
    .prepare("SELECT datetime('now') > ? as expired")
    .get(row.expires_at).expired;

  if (expired) {
    db.prepare("UPDATE driver_login_challenges SET status='expired' WHERE id=?").run(
      row.id
    );
    return res.status(400).json({ error: "challenge_expired" });
  }

  if (row.status !== "pending") {
    return res.status(400).json({ error: "invalid_challenge_status" });
  }

  db.prepare("UPDATE driver_login_challenges SET status='confirmed' WHERE id=?").run(
    row.id
  );

  return res.json({ ok: true });
});

router.post("/complete", (req, res) => {
  const parsed = confirmSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "invalid_input", details: parsed.error.flatten() });
  }

  const { challenge_id, external_driver_id } = parsed.data;
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
    db.prepare("UPDATE driver_login_challenges SET status='expired' WHERE id=?").run(
      row.id
    );
    return res.status(400).json({ error: "challenge_expired" });
  }

  if (row.status !== "confirmed") {
    return res.status(403).json({ error: "challenge_not_confirmed" });
  }

  // Real integration point: fetch driver record from Logicline (server-to-server API key).
  // Demo driver attributes:
  const driverName = `Logicline Driver ${external_driver_id}`;
  const email = `${external_driver_id}@logicline.myride.local`.toLowerCase();

  const insertUser = db.prepare(
    `
    INSERT INTO users (role, external_source, external_id, email, password_hash, name)
    VALUES ('driver', ?, ?, ?, ?, ?)
  `
  );

  const findUser = db.prepare(
    "SELECT id, role, email, name FROM users WHERE external_source=? AND external_id=?"
  );

  const insertProfile = db.prepare(
    `
    INSERT INTO driver_profiles (user_id, license_plate, vehicle_type, photo_url, approval_status, online, lat, lng)
    VALUES (?, ?, ?, NULL, 'approved', 0, NULL, NULL)
  `
  );

  const tx = db.transaction(() => {
    let user = findUser.get(EXTERNAL_SOURCE, external_driver_id);
    if (!user) {
      const pwd = hashPassword(`qr-${Date.now()}-${Math.random()}`);
      const info = insertUser.run(
        EXTERNAL_SOURCE,
        external_driver_id,
        email,
        pwd,
        driverName
      );
      const userId = Number(info.lastInsertRowid);
      user = db
        .prepare("SELECT id, role, email, name FROM users WHERE id=?")
        .get(userId);

      // Create driver profile if missing
      insertProfile.run(userId, `QR-${external_driver_id}`.slice(0, 20), "Mini");
    } else {
      const profile = db
        .prepare("SELECT user_id FROM driver_profiles WHERE user_id=?")
        .get(user.id);
      if (!profile) {
        insertProfile.run(user.id, `QR-${external_driver_id}`.slice(0, 20), "Mini");
      }
    }

    db.prepare("UPDATE driver_login_challenges SET status='used' WHERE id=?").run(
      row.id
    );

    const token = signToken(user);
    return { token, user };
  });

  const out = tx();
  return res.json(out);
});

export default router;

