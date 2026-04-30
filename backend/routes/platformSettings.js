import express from "express";
import { z } from "zod";
import { db } from "../database.js";
import { authRequired, roleRequired } from "../auth.js";

const router = express.Router();

router.use(authRequired, roleRequired("admin"));

router.get("/", (_req, res) => {
  const row = db
    .prepare(
      "SELECT owner_commission_pct, driver_earnings_pct, updated_at FROM platform_settings WHERE id=1"
    )
    .get();
  return res.json({
    owner_commission_pct: Number(row?.owner_commission_pct ?? 51),
    driver_earnings_pct: Number(row?.driver_earnings_pct ?? 49),
    updated_at: row?.updated_at || null,
  });
});

const updateSchema = z.object({
  owner_commission_pct: z.number().int().min(0).max(100),
  driver_earnings_pct: z.number().int().min(0).max(100),
});

router.put("/", (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "invalid_input", details: parsed.error.flatten() });
  }
  const { owner_commission_pct, driver_earnings_pct } = parsed.data;
  if (owner_commission_pct + driver_earnings_pct !== 100) {
    return res.status(400).json({ error: "split_must_sum_to_100" });
  }
  db.prepare(
    "UPDATE platform_settings SET owner_commission_pct=?, driver_earnings_pct=?, updated_at=datetime('now') WHERE id=1"
  ).run(owner_commission_pct, driver_earnings_pct);
  return res.json({ ok: true });
});

export default router;

