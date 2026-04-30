import express from "express";
import { z } from "zod";
import { db } from "../database.js";
import { authRequired, roleRequired } from "../auth.js";

const router = express.Router();

function getSettings() {
  const row = db
    .prepare("SELECT country, currency, province, city FROM app_settings WHERE id=1")
    .get();
  return {
    country: row?.country || "ZA",
    currency: row?.currency || "ZAR",
    province: row?.province || "",
    city: row?.city || "",
  };
}

router.get("/", (_req, res) => {
  res.json(getSettings());
});

const putSchema = z.object({
  country: z.string().trim().min(2).max(2),
  currency: z.string().trim().min(3).max(3),
  province: z.string().trim().max(60).optional().default(""),
  city: z.string().trim().max(60).optional().default(""),
});

router.put("/", authRequired, roleRequired("admin"), (req, res) => {
  const parsed = putSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "invalid_input", details: parsed.error.flatten() });
  }
  const country = parsed.data.country.toUpperCase();
  const currency = parsed.data.currency.toUpperCase();
  const province = String(parsed.data.province || "").trim();
  const city = String(parsed.data.city || "").trim();
  db.prepare(
    "UPDATE app_settings SET country=?, currency=?, province=?, city=? WHERE id=1"
  ).run(country, currency, province || null, city || null);
  res.json({ ok: true, settings: getSettings() });
});

export default router;

