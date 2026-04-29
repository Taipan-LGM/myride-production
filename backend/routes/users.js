import express from "express";
import { z } from "zod";
import { db } from "../database.js";
import {
  authRequired,
  hashPassword,
  signToken,
  verifyPassword,
} from "../auth.js";

const router = express.Router();

const emailSchema = z.string().trim().toLowerCase().email();
const passwordSchema = z.string().min(8).max(72);
const nameSchema = z.string().trim().min(2).max(60);

const registerSchema = z.object({
  role: z.enum(["customer", "driver"]),
  email: emailSchema,
  password: passwordSchema,
  name: nameSchema,
  license_plate: z.string().trim().min(2).max(20).optional(),
  vehicle_type: z.enum(["Auto", "Mini", "Sedan", "Bike"]).optional(),
  photo_url: z.string().trim().min(3).max(500).optional(),
});

router.post("/register", (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "invalid_input", details: parsed.error.flatten() });
  }

  const data = parsed.data;
  const email = data.email;

  const existing = db.prepare("SELECT id FROM users WHERE email=?").get(email);
  if (existing) return res.status(409).json({ error: "email_already_in_use" });

  const password_hash = hashPassword(data.password);

  const insertUser = db.prepare(
    "INSERT INTO users (role, email, password_hash, name) VALUES (?, ?, ?, ?)"
  );

  const insertDriverProfile = db.prepare(
    "INSERT INTO driver_profiles (user_id, license_plate, vehicle_type, photo_url, approval_status, online, lat, lng) VALUES (?, ?, ?, ?, 'pending', 0, NULL, NULL)"
  );

  const tx = db.transaction(() => {
    const info = insertUser.run(data.role, email, password_hash, data.name);
    const userId = Number(info.lastInsertRowid);

    if (data.role === "driver") {
      if (!data.license_plate || !data.vehicle_type) {
        throw new Error("missing_driver_fields");
      }
      insertDriverProfile.run(
        userId,
        data.license_plate,
        data.vehicle_type,
        data.photo_url || null
      );
    }

    return userId;
  });

  try {
    const userId = tx();
    const user = db
      .prepare("SELECT id, role, email, name FROM users WHERE id=?")
      .get(userId);
    const token = signToken(user);
    return res.status(201).json({ token, user });
  } catch (e) {
    if (String(e?.message) === "missing_driver_fields") {
      return res.status(400).json({ error: "driver_fields_required" });
    }
    return res.status(500).json({ error: "server_error" });
  }
});

const loginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

router.post("/login", (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "invalid_input", details: parsed.error.flatten() });
  }

  const { email, password } = parsed.data;
  const user = db
    .prepare(
      "SELECT id, role, email, name, password_hash FROM users WHERE email=?"
    )
    .get(email);

  if (!user) return res.status(401).json({ error: "invalid_credentials" });
  if (!verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: "invalid_credentials" });
  }

  const token = signToken(user);
  return res.json({
    token,
    user: { id: user.id, role: user.role, email: user.email, name: user.name },
  });
});

router.get("/me", authRequired, (req, res) => {
  const user = req.user;
  if (user.role === "driver") {
    const profile = db
      .prepare(
        "SELECT user_id, license_plate, vehicle_type, photo_url, approval_status, online, lat, lng, earnings_cents FROM driver_profiles WHERE user_id=?"
      )
      .get(user.id);
    return res.json({ user, driver_profile: profile || null });
  }
  return res.json({ user });
});

export default router;

