import crypto from "crypto";
import express from "express";
import { z } from "zod";
import { db } from "../database.js";
import { authRequired, roleRequired } from "../auth.js";
import { getZonelessClient, zonelessWebhookSecret } from "../services/zonelessService.js";

const router = express.Router();

function computeHmacSha256Hex(secret, rawBody) {
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

function verifyWebhook(req) {
  const secret = zonelessWebhookSecret();
  if (!secret) return false;
  const sig =
    String(req.headers["zoneless-signature"] || req.headers["x-zoneless-signature"] || "")
      .trim()
      .toLowerCase();
  if (!sig) return false;
  const raw = req.rawBody || req.bodyRaw || req.body || "";
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw));
  const expected = computeHmacSha256Hex(secret, buf).toLowerCase();
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function moneyToUsdcMinor(cents) {
  // App uses cents internally; USDC has 6 decimals. We store in "cents" already,
  // so convert cents -> USDC minor by multiplying by 10_000 (0.01 * 1e6).
  return Math.round(Number(cents) * 10_000);
}

// Admin/owner triggers payout once ride is completed + paid.
const payoutSchema = z.object({ ride_id: z.number().int().positive() });

router.post("/payout-driver", authRequired, roleRequired("admin"), async (req, res) => {
  const parsed = payoutSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "invalid_input", details: parsed.error.flatten() });
  }
  const rideId = parsed.data.ride_id;
  const ride = db.prepare("SELECT * FROM rides WHERE id=?").get(rideId);
  if (!ride) return res.status(404).json({ error: "ride_not_found" });
  if (ride.status !== "completed") {
    return res.status(400).json({ error: "ride_not_completed" });
  }
  if (ride.payment_status !== "paid") {
    return res.status(400).json({ error: "stripe_not_paid" });
  }
  if (ride.payout_status && ride.payout_status !== "unpaid") {
    return res.status(400).json({ error: "payout_already_started" });
  }

  const driverId = ride.driver_id;
  if (!driverId) return res.status(400).json({ error: "no_driver_assigned" });

  const dp = db
    .prepare("SELECT wallet_address FROM driver_profiles WHERE user_id=?")
    .get(driverId);
  const wallet = String(dp?.wallet_address || "").trim();
  if (!wallet) return res.status(400).json({ error: "driver_wallet_missing" });

  const driverCents = Number(ride.driver_earnings_cents ?? 0);
  if (!Number.isFinite(driverCents) || driverCents <= 0) {
    return res.status(400).json({ error: "driver_share_missing" });
  }

  const zoneless = await getZonelessClient();

  // Minimal self-hosted Zoneless flow: create transfer to a connected account, then payout.
  // For this codebase we treat "wallet_address" as already onboarded (simplified).
  // In production you should store a zoneless account id per driver and use account onboarding links.
  const metadata = { ride_id: String(rideId), driver_id: String(driverId) };

  // If you have a real Zoneless account per driver, set destination to that account id.
  // Here we use a placeholder "acct" stored in driver_profiles.wallet_address when it starts with "acct_z_".
  const destination = wallet.startsWith("acct_z_") ? wallet : null;
  if (!destination) {
    return res.status(400).json({
      error: "zoneless_account_required",
      message:
        "Driver wallet must be a Zoneless connected account id (acct_z_...). Add onboarding later, or store Zoneless account id in driver profile.",
    });
  }

  const amount = moneyToUsdcMinor(driverCents);

  db.prepare("UPDATE rides SET payout_status='initiated' WHERE id=?").run(rideId);

  const transfer = await zoneless.transfers.create({
    amount,
    currency: "usdc",
    destination,
    description: `My Ride payout transfer for ride #${rideId}`,
    metadata,
  });

  const payout = await zoneless.payouts.create(
    { amount, currency: "usdc", metadata },
    { zonelessAccount: destination }
  );

  db.prepare(
    "UPDATE rides SET payout_status='processing', zoneless_transfer_id=?, zoneless_payout_id=? WHERE id=?"
  ).run(String(transfer.id || ""), String(payout.id || ""), rideId);

  db.prepare(
    "INSERT INTO ride_events (ride_id, type, message) VALUES (?, 'payout_initiated', ?)"
  ).run(rideId, `Zoneless payout started: ${payout.id || "unknown"}`);

  return res.json({ ok: true, transfer_id: transfer.id, payout_id: payout.id });
});

// Zoneless webhook (raw body must be captured by server similar to Stripe)
router.post("/webhook", async (req, res) => {
  if (!verifyWebhook(req)) {
    return res.status(400).send("Webhook signature verification failed");
  }
  let event;
  try {
    const raw = req.rawBody || req.body;
    const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw || "");
    event = JSON.parse(text);
  } catch {
    return res.status(400).send("Invalid JSON");
  }

  try {
    const type = String(event.type || "");
    const obj = event.data?.object || {};

    if (type === "payout.paid" || type === "payout.completed") {
      const payoutId = String(obj.id || "");
      const rideId = Number(obj.metadata?.ride_id);
      if (payoutId && Number.isFinite(rideId)) {
        db.prepare(
          "UPDATE rides SET payout_status='paid_out', zoneless_payout_id=COALESCE(zoneless_payout_id, ?) WHERE id=?"
        ).run(payoutId, rideId);
        db.prepare(
          "INSERT INTO ride_events (ride_id, type, message) VALUES (?, 'payout_paid', 'Driver payout confirmed (Zoneless)')"
        ).run(rideId);
      }
    }

    return res.json({ received: true });
  } catch {
    return res.status(500).send("Webhook handler failure");
  }
});

export default router;

