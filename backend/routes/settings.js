import express from "express";
import { z } from "zod";
import { db } from "../database.js";
import { authRequired, roleRequired } from "../auth.js";

const router = express.Router();

function getSettings() {
  const row = db
    .prepare(
      `SELECT country, currency, province, city, geocode_za_only,
              rand_per_km, address_suggest_debounce_ms,
              fare_distance_source, carttrack_api_base_url
       FROM app_settings WHERE id=1`
    )
    .get();
  const fareSrc = String(row?.fare_distance_source || "osrm").toLowerCase();
  const allowed = ["straight_line", "osrm", "carttrack"];
  return {
    country: row?.country || "ZA",
    currency: row?.currency || "ZAR",
    province: row?.province || "",
    city: row?.city || "",
    geocode_za_only: Number(row?.geocode_za_only) === 1,
    rand_per_km:
      row?.rand_per_km != null ? Number(row.rand_per_km) : 12,
    address_suggest_debounce_ms:
      row?.address_suggest_debounce_ms != null
        ? Number(row.address_suggest_debounce_ms)
        : 55,
    fare_distance_source: allowed.includes(fareSrc) ? fareSrc : "osrm",
    carttrack_api_base_url: row?.carttrack_api_base_url
      ? String(row.carttrack_api_base_url)
      : "",
    carttrack_api_key_configured: Boolean(
      String(process.env.CARTTRACK_API_KEY || "").trim()
    ),
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
  geocode_za_only: z.boolean(),
  rand_per_km: z.coerce.number().min(0.01).max(999),
  address_suggest_debounce_ms: z.coerce.number().int().min(30).max(800),
  fare_distance_source: z
    .enum(["straight_line", "osrm", "carttrack"])
    .optional()
    .default("osrm"),
  carttrack_api_base_url: z.string().trim().max(500).optional().default(""),
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
  const geocodeZaOnly = parsed.data.geocode_za_only ? 1 : 0;
  const randPerKm = Number(parsed.data.rand_per_km);
  const debounceMs = Number(parsed.data.address_suggest_debounce_ms);
  const fareDistanceSource = parsed.data.fare_distance_source || "osrm";
  const carttrackUrl = String(parsed.data.carttrack_api_base_url || "").trim();
  db.prepare(
    `UPDATE app_settings SET country=?, currency=?, province=?, city=?, geocode_za_only=?,
     rand_per_km=?, address_suggest_debounce_ms=?,
     fare_distance_source=?, carttrack_api_base_url=? WHERE id=1`
  ).run(
    country,
    currency,
    province || null,
    city || null,
    geocodeZaOnly,
    randPerKm,
    debounceMs,
    fareDistanceSource,
    carttrackUrl || null
  );
  res.json({ ok: true, settings: getSettings() });
});

export default router;
