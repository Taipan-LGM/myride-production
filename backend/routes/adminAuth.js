import express from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { db } from "../database.js";
import { signToken, verifyPassword } from "../auth.js";

const router = express.Router();

const authRouteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests" },
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  pin: z.string().min(4).max(72),
});

/** Admin-only sign-in (email + PIN). Staff use QR cards via /api/staff-auth. */
router.post("/login", authRouteLimiter, (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "invalid_input", details: parsed.error.flatten() });
  }

  const { email, pin } = parsed.data;
  const user = db
    .prepare(
      "SELECT id, role, email, name, password_hash FROM users WHERE email=? AND role='admin'"
    )
    .get(email);

  if (!user) return res.status(401).json({ error: "invalid_credentials" });
  if (!verifyPassword(pin, user.password_hash)) {
    return res.status(401).json({ error: "invalid_credentials" });
  }

  const token = signToken(user);
  return res.json({
    token,
    user: { id: user.id, role: user.role, email: user.email, name: user.name },
  });
});

export default router;
