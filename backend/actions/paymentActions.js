import Stripe from "stripe";
import { db } from "../database.js";
import { logger } from "../lib/logger.js";
import { PaymentError } from "../errors/index.js";
import { emitRideUpdated } from "../services/rideSocketService.js";

/** Lazy Stripe client — empty STRIPE_SECRET_KEY must not crash boot (Render without keys). */
function stripeSecretKey() {
  return String(process.env.STRIPE_SECRET_KEY || "").trim();
}

let _stripe = null;
function getStripe() {
  const secret = stripeSecretKey();
  if (!secret || !secret.startsWith("sk_")) {
    throw new PaymentError("SVR_003", null, "stripe_not_configured");
  }
  if (!_stripe) {
    _stripe = new Stripe(secret, { apiVersion: "2024-06-20" });
  }
  return _stripe;
}

export class PaymentActionError extends Error {
  constructor(code, message, httpStatus = 400) {
    super(message);
    this.name = "PaymentActionError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function stripeCurrency() {
  const row = db.prepare("SELECT currency FROM app_settings WHERE id=1").get();
  const raw = String(row?.currency || "usd").trim().toLowerCase();
  return /^[a-z]{3}$/.test(raw) ? raw : "usd";
}

function minimumChargeUnits(currency) {
  const c = String(currency || "usd").toLowerCase();
  const env = Number(process.env.STRIPE_MIN_CHARGE_CENTS || "");
  if (Number.isFinite(env) && env > 0) return env;
  const table = { usd: 50, eur: 50, gbp: 30, zar: 100, aud: 50, cad: 50 };
  return table[c] ?? 50;
}

function assertStripeConfigured() {
  const secret = stripeSecretKey();
  if (!secret || !secret.startsWith("sk_")) {
    throw new PaymentError("SVR_003", null, "stripe_not_configured");
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
  return { owner_commission_cents: owner, driver_earnings_cents: total - owner, owner_pct: ownerPct };
}

function getRideForCustomer(rideId, customerId) {
  const ride = db.prepare("SELECT * FROM rides WHERE id=?").get(rideId);
  if (!ride) throw new PaymentActionError("ride_not_found", "Ride not found", 404);
  if (ride.customer_id !== customerId) {
    throw new PaymentActionError("forbidden", "Forbidden", 403);
  }
  return ride;
}

function emitRidePaymentUpdate(io, ride) {
  if (!io || !ride) return;
  emitRideUpdated(io, ride);
}

/**
 * Create Stripe PaymentIntent for a ride (card payment).
 */
export async function createRidePaymentIntent(customerId, rideId) {
  assertStripeConfigured();
  const ride = getRideForCustomer(rideId, customerId);

  if (ride.payment_status !== "requires_payment") {
    throw new PaymentActionError("payment_not_required_yet", "Payment not required yet", 400);
  }

  const currency = stripeCurrency();
  const minUnits = minimumChargeUnits(currency);
  let amount = Number(ride.final_fare_cents ?? ride.fare_estimate_cents);
  if (!Number.isFinite(amount) || amount <= 0) amount = minUnits;
  amount = Math.max(amount, minUnits);

  const { owner_commission_cents, driver_earnings_cents, owner_pct } =
    computeSplitCents(amount);

  db.prepare(
    "UPDATE rides SET owner_commission_cents=?, driver_earnings_cents=? WHERE id=?"
  ).run(owner_commission_cents, driver_earnings_cents, rideId);

  const destination = String(process.env.STRIPE_DESTINATION_ACCOUNT_ID || "").trim();
  const useConnect =
    String(process.env.STRIPE_USE_CONNECT_DESTINATION || "").trim() === "1" &&
    destination.startsWith("acct_");

  const piParams = {
    amount,
    currency,
    automatic_payment_methods: { enabled: true },
    metadata: {
      ride_id: String(rideId),
      customer_id: String(customerId),
      owner_commission_cents: String(owner_commission_cents),
      driver_earnings_cents: String(driver_earnings_cents),
      owner_commission_pct: String(owner_pct),
    },
    description: `My Ride #${rideId}`,
  };

  if (useConnect) {
    piParams.application_fee_amount = owner_commission_cents;
    piParams.transfer_data = { destination };
  }

  try {
    const pi = await getStripe().paymentIntents.create(piParams);
    db.prepare("UPDATE rides SET stripe_payment_intent_id=? WHERE id=?").run(pi.id, rideId);
    db.prepare(
      "INSERT INTO ride_events (ride_id, type, message) VALUES (?, 'stripe_pi_created', ?)"
    ).run(rideId, `PaymentIntent created: ${pi.id}`);

    return {
      client_secret: pi.client_secret,
      payment_intent_id: pi.id,
      amount_cents: amount,
      currency,
      owner_commission_cents,
      driver_earnings_cents,
      stripe_connect_destination: useConnect,
    };
  } catch (err) {
    logger.error("Stripe PaymentIntent failed", err);
    throw new PaymentError("PAY_004", { ride_id: rideId }, err.message);
  }
}

/**
 * Create Stripe Checkout session for a ride.
 */
export async function createCheckoutSession(customerId, rideId, { successUrl, cancelUrl }) {
  assertStripeConfigured();
  const ride = getRideForCustomer(rideId, customerId);

  if (ride.payment_status !== "requires_payment") {
    throw new PaymentActionError("payment_not_required_yet", "Payment not required yet", 400);
  }

  const amount = ride.final_fare_cents ?? ride.fare_estimate_cents;
  const currency = stripeCurrency();

  try {
    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: String(ride.id),
      metadata: {
        ride_id: String(ride.id),
        customer_id: String(customerId),
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: amount,
            product_data: {
              name: `My Ride Trip #${ride.id}`,
              description: `Vehicle: ${ride.vehicle_type} | ${ride.pickup_text} → ${ride.dropoff_text}`,
            },
          },
        },
      ],
    });

    db.prepare("UPDATE rides SET stripe_checkout_session_id=? WHERE id=?").run(
      session.id,
      rideId
    );
    db.prepare(
      "INSERT INTO ride_events (ride_id, type, message) VALUES (?, 'stripe_checkout_created', ?)"
    ).run(rideId, `Stripe Checkout created: ${session.id}`);

    return { url: session.url, session_id: session.id };
  } catch (err) {
    logger.error("Stripe Checkout failed", err);
    throw new PaymentError("PAY_004", { ride_id: rideId }, err.message);
  }
}

export function markRidePaid(rideId, paymentIntentId, { io } = {}) {
  db.prepare(
    "UPDATE rides SET payment_status='paid', stripe_payment_intent_id=? WHERE id=?"
  ).run(paymentIntentId, rideId);
  db.prepare(
    "INSERT INTO ride_events (ride_id, type, message) VALUES (?, 'payment_paid', 'Stripe payment confirmed')"
  ).run(rideId);
  const ride = db.prepare("SELECT * FROM rides WHERE id=?").get(rideId);
  emitRidePaymentUpdate(io, ride);
  return ride;
}

export function markRidePaymentFailed(rideId, { io } = {}) {
  db.prepare("UPDATE rides SET payment_status='failed' WHERE id=?").run(rideId);
  db.prepare(
    "INSERT INTO ride_events (ride_id, type, message) VALUES (?, 'payment_failed', 'Stripe payment failed')"
  ).run(rideId);
  const ride = db.prepare("SELECT * FROM rides WHERE id=?").get(rideId);
  emitRidePaymentUpdate(io, ride);
  return ride;
}

function stripeLiveKeysConfigured() {
  const sk = String(process.env.STRIPE_SECRET_KEY || "");
  const pk = String(process.env.STRIPE_PUBLISHABLE_KEY || "");
  return (
    sk.startsWith("sk_") &&
    pk.startsWith("pk_") &&
    !/replace/i.test(sk) &&
    !/replace/i.test(pk)
  );
}

export function mockPayAllowed() {
  if (process.env.ALLOW_MOCK_PAYMENTS === "0") return false;
  if (process.env.ALLOW_MOCK_PAYMENTS === "1") return true;
  if (process.env.NODE_ENV !== "production") return true;
  return !stripeLiveKeysConfigured();
}

export function recordMockPayment(customerId, rideId, { io } = {}) {
  if (!mockPayAllowed()) {
    throw new PaymentActionError("not_found", "Not found", 404);
  }
  const ride = getRideForCustomer(rideId, customerId);
  db.prepare(
    "UPDATE rides SET payment_status='paid', stripe_payment_intent_id=COALESCE(stripe_payment_intent_id, ?) WHERE id=?"
  ).run(`mock_pi_${Date.now()}`, rideId);
  db.prepare(
    "INSERT INTO ride_events (ride_id, type, message) VALUES (?, 'payment_paid', 'Payment simulated (dev)')"
  ).run(rideId);
  const updated = db.prepare("SELECT * FROM rides WHERE id=?").get(rideId);
  emitRidePaymentUpdate(io, updated);
  return updated;
}

/**
 * Payment history from rides table (legacy schema has no payments table).
 */
export function getPaymentHistory(userId, role, { page = 1, limit = 20 } = {}) {
  const offset = (page - 1) * limit;
  const column = role === "driver" ? "driver_id" : "customer_id";

  const payments = db
    .prepare(
      `
      SELECT
        id AS ride_id,
        final_fare_cents,
        fare_estimate_cents,
        payment_status,
        stripe_payment_intent_id,
        stripe_checkout_session_id,
        pickup_text,
        dropoff_text,
        completed_at,
        requested_at
      FROM rides
      WHERE ${column} = ?
        AND payment_status IN ('requires_payment', 'paid', 'failed', 'refunded')
      ORDER BY COALESCE(completed_at, requested_at) DESC
      LIMIT ? OFFSET ?
    `
    )
    .all(userId, limit, offset);

  const total = db
    .prepare(
      `
      SELECT COUNT(*) AS count FROM rides
      WHERE ${column} = ?
        AND payment_status IN ('requires_payment', 'paid', 'failed', 'refunded')
    `
    )
    .get(userId);

  return {
    payments,
    pagination: {
      page,
      limit,
      total: total?.count || 0,
      pages: Math.ceil((total?.count || 0) / limit),
    },
  };
}

export function getStripePublicConfig() {
  return {
    publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || "",
    currency: stripeCurrency(),
  };
}

function getRideForDriver(rideId, driverUserId) {
  const ride = db.prepare("SELECT * FROM rides WHERE id=?").get(rideId);
  if (!ride) throw new PaymentActionError("ride_not_found", "Ride not found", 404);
  if (ride.driver_id !== driverUserId) {
    throw new PaymentActionError("forbidden", "Forbidden", 403);
  }
  return ride;
}

/**
 * Confirm capture for a succeeded PaymentIntent (driver or webhook parity).
 */
export async function capturePayment(paymentIntentId, rideId, actorUserId, { io } = {}) {
  const ride = db.prepare("SELECT * FROM rides WHERE id=?").get(rideId);
  if (!ride) throw new PaymentActionError("ride_not_found", "Ride not found", 404);

  const isDriver = ride.driver_id === actorUserId;
  const isCustomer = ride.customer_id === actorUserId;
  if (!isDriver && !isCustomer) {
    throw new PaymentActionError("forbidden", "Forbidden", 403);
  }

  if (ride.stripe_payment_intent_id && ride.stripe_payment_intent_id !== paymentIntentId) {
    throw new PaymentActionError("payment_not_required_yet", "Payment intent mismatch", 400);
  }

  if (ride.payment_status === "paid") {
    return { ride_id: rideId, status: "paid", payment_intent_id: paymentIntentId };
  }

  assertStripeConfigured();
  try {
    const pi = await getStripe().paymentIntents.retrieve(paymentIntentId);
    if (pi.status === "requires_capture") {
      await getStripe().paymentIntents.capture(paymentIntentId);
    }
    if (!["succeeded", "requires_capture"].includes(pi.status) && pi.status !== "processing") {
      throw new PaymentActionError("payment_init_failed", `Payment status: ${pi.status}`, 400);
    }
    const updated = markRidePaid(rideId, paymentIntentId, { io });
    return {
      ride_id: rideId,
      status: "paid",
      payment_intent_id: paymentIntentId,
      amount_cents: updated.final_fare_cents ?? updated.fare_estimate_cents,
    };
  } catch (err) {
    if (err instanceof PaymentActionError) throw err;
    logger.error("capturePayment failed", err);
    throw new PaymentError("PAY_004", { ride_id: rideId }, err.message);
  }
}

/**
 * Refund a paid ride (admin). Updates legacy rides.payment_status.
 */
export async function refundRidePayment(rideId, { amountCents = null, reason = null } = {}) {
  const ride = db.prepare("SELECT * FROM rides WHERE id=?").get(rideId);
  if (!ride) throw new PaymentActionError("ride_not_found", "Ride not found", 404);
  if (ride.payment_status !== "paid") {
    throw new PaymentActionError("payment_init_failed", "Payment not captured", 400);
  }

  if (ride.stripe_payment_intent_id?.startsWith("pi_")) {
    assertStripeConfigured();
    try {
      await getStripe().refunds.create({
        payment_intent: ride.stripe_payment_intent_id,
        amount: amountCents ? Math.round(amountCents) : undefined,
        reason: "requested_by_customer",
        metadata: reason ? { reason } : undefined,
      });
    } catch (err) {
      logger.error("Stripe refund failed", err);
      throw new PaymentError("PAY_006", { ride_id: rideId }, err.message);
    }
  }

  db.prepare("UPDATE rides SET payment_status='refunded' WHERE id=?").run(rideId);
  db.prepare(
    "INSERT INTO ride_events (ride_id, type, message) VALUES (?, 'payment_refunded', ?)"
  ).run(rideId, reason || "Refund processed");

  return {
    ride_id: rideId,
    status: "refunded",
    amount_cents: amountCents ?? ride.final_fare_cents ?? ride.fare_estimate_cents,
  };
}

/**
 * Record cash payment on a completed ride (driver).
 */
export function recordCashPayment(driverUserId, rideId, amountCents) {
  const ride = getRideForDriver(rideId, driverUserId);
  if (ride.status !== "completed") {
    throw new PaymentActionError("payment_not_required_yet", "Ride not completed", 400);
  }

  const cents = Math.max(0, Math.round(Number(amountCents) || 0));
  db.prepare(
    "UPDATE rides SET payment_status='paid', final_fare_cents=COALESCE(final_fare_cents, ?) WHERE id=?"
  ).run(cents || ride.final_fare_cents || ride.fare_estimate_cents, rideId);
  db.prepare(
    "INSERT INTO ride_events (ride_id, type, message) VALUES (?, 'payment_paid', 'Cash payment recorded')"
  ).run(rideId);

  const updated = db.prepare("SELECT * FROM rides WHERE id=?").get(rideId);
  return {
    ride_id: rideId,
    status: "paid",
    method: "cash",
    amount_cents: updated.final_fare_cents ?? updated.fare_estimate_cents,
  };
}

/** Placeholder withdrawal request (Zoneless integration TBD). */
export function requestWithdrawal(driverUserId, { amount, method, account_details = null }) {
  const profile = db
    .prepare("SELECT earnings_cents FROM driver_profiles WHERE user_id=?")
    .get(driverUserId);
  if (!profile) throw new PaymentActionError("not_found", "Driver not found", 404);

  const amountCents = Math.round(Number(amount) * 100);
  if (amountCents <= 0 || amountCents > (profile.earnings_cents || 0)) {
    throw new PaymentActionError("payment_init_failed", "Insufficient balance", 400);
  }

  return {
    withdrawal_id: `WD-${Date.now()}`,
    driver_id: String(driverUserId),
    amount_cents: amountCents,
    method,
    account_details,
    status: "pending",
    message: "Withdrawal request submitted for processing",
    estimated_processing_time: "1-2 business days",
  };
}

export { getStripe as stripe, getStripe, stripeCurrency, assertStripeConfigured };
