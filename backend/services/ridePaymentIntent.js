import Stripe from "stripe";
import { z } from "zod";
import { db } from "../database.js";

const stripeSecret = process.env.STRIPE_SECRET_KEY || "";
const stripe = new Stripe(stripeSecret, { apiVersion: "2024-06-20" });

function stripeCurrency() {
  const row = db.prepare("SELECT currency FROM app_settings WHERE id=1").get();
  return String(row?.currency || "usd").toLowerCase();
}

function assertStripeConfigured() {
  if (!stripeSecret || !stripeSecret.startsWith("sk_")) {
    const err = new Error("stripe_not_configured");
    err.status = 500;
    throw err;
  }
}

function computeSplitCents(totalCents) {
  const row = db
    .prepare(
      "SELECT owner_commission_pct, driver_earnings_pct FROM platform_settings WHERE id=1"
    )
    .get();
  const ownerPct = Number(row?.owner_commission_pct ?? 51);
  const total = Math.max(0, Math.round(Number(totalCents) || 0));
  const owner = Math.min(total, Math.round((total * ownerPct) / 100));
  const driver = total - owner;
  return { owner_cents: owner, driver_cents: driver, owner_pct: ownerPct };
}

/**
 * POST /api/payments/create-ride-payment and POST /api/create-ride-payment
 * Creates a Stripe PaymentIntent for the full ride fare.
 *
 * Default: funds settle on the **platform** Stripe account (owner). Split cents are stored on the ride
 * for Zoneless USDC payout to the driver.
 *
 * Optional Connect-style split (money to a connected Stripe account instead of Zoneless):
 * Set STRIPE_DESTINATION_ACCOUNT_ID (+ STRIPE_USE_CONNECT_DESTINATION=1) to send (amount - application_fee)
 * to the connected account while the platform keeps application_fee_amount as owner commission.
 */
const ridePaySchema = z.object({ ride_id: z.number().int().positive() });

export async function createRidePaymentIntent(req, res) {
  try {
    assertStripeConfigured();
    const parsed = ridePaySchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "invalid_input", details: parsed.error.flatten() });
    }
    const rideId = parsed.data.ride_id;

    const ride = db.prepare("SELECT * FROM rides WHERE id=?").get(rideId);
    if (!ride) return res.status(404).json({ error: "ride_not_found" });
    if (ride.customer_id !== req.user.id) {
      return res.status(403).json({ error: "forbidden" });
    }
    if (ride.payment_status !== "requires_payment") {
      return res.status(400).json({ error: "payment_not_required_yet" });
    }

    const amount = Number(ride.final_fare_cents ?? ride.fare_estimate_cents);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "invalid_amount" });
    }

    const { owner_cents, driver_cents, owner_pct } = computeSplitCents(amount);

    db.prepare(
      "UPDATE rides SET owner_commission_cents=?, driver_earnings_cents=? WHERE id=?"
    ).run(owner_cents, driver_cents, rideId);

    const currency = stripeCurrency();
    const destination = String(process.env.STRIPE_DESTINATION_ACCOUNT_ID || "").trim();
    const useConnect =
      String(process.env.STRIPE_USE_CONNECT_DESTINATION || "").trim() === "1" &&
      destination.startsWith("acct_");

    const metadata = {
      ride_id: String(rideId),
      customer_id: String(req.user.id),
      owner_commission_cents: String(owner_cents),
      driver_earnings_cents: String(driver_cents),
      owner_commission_pct: String(owner_pct),
    };

    const piParams = {
      amount,
      currency,
      automatic_payment_methods: { enabled: true },
      metadata,
      description: `My Ride #${rideId}`,
    };

    if (useConnect) {
      piParams.application_fee_amount = owner_cents;
      piParams.transfer_data = { destination };
    }

    const pi = await stripe.paymentIntents.create(piParams);

    db.prepare("UPDATE rides SET stripe_payment_intent_id=? WHERE id=?").run(pi.id, rideId);
    db.prepare(
      "INSERT INTO ride_events (ride_id, type, message) VALUES (?, 'stripe_pi_created', ?)"
    ).run(rideId, `PaymentIntent created: ${pi.id}`);

    return res.json({
      client_secret: pi.client_secret,
      payment_intent_id: pi.id,
      amount_cents: amount,
      currency,
      owner_commission_cents: owner_cents,
      driver_earnings_cents: driver_cents,
      stripe_connect_destination: useConnect,
    });
  } catch (e) {
    const status = e?.status || 500;
    return res.status(status).json({ error: "payment_init_failed" });
  }
}
