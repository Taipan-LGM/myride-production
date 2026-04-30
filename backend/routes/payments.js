import express from "express";
import Stripe from "stripe";
import { z } from "zod";
import { db } from "../database.js";
import { authRequired, roleRequired } from "../auth.js";
import { createRidePaymentIntent } from "../services/ridePaymentIntent.js";

const router = express.Router();
const NODE_ENV = process.env.NODE_ENV || "development";

const stripeSecret = process.env.STRIPE_SECRET_KEY || "";
const stripe = new Stripe(stripeSecret, { apiVersion: "2024-06-20" });

function stripeCurrency() {
  const row = db
    .prepare("SELECT currency FROM app_settings WHERE id=1")
    .get();
  const c = String(row?.currency || "USD").toLowerCase();
  return c;
}

const publicAppBase = process.env.RENDER_EXTERNAL_URL?.trim().replace(/\/$/, "") || "";

const SUCCESS_URL =
  process.env.STRIPE_SUCCESS_URL ||
  (publicAppBase
    ? `${publicAppBase}/#/customer?paid=1`
    : "http://localhost:3000/#/customer?paid=1");
const CANCEL_URL =
  process.env.STRIPE_CANCEL_URL ||
  (publicAppBase
    ? `${publicAppBase}/#/customer?paid=0`
    : "http://localhost:3000/#/customer?paid=0");

function assertStripeConfigured() {
  if (!stripeSecret || !stripeSecret.startsWith("sk_")) {
    const err = new Error("stripe_not_configured");
    err.status = 500;
    throw err;
  }
}

router.get("/public-config", (_req, res) => {
  return res.json({
    publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || "",
    currency: stripeCurrency(),
  });
});

router.post(
  "/create-ride-payment",
  authRequired,
  roleRequired("customer"),
  createRidePaymentIntent
);

const createCheckoutSchema = z.object({
  ride_id: z.number().int().positive(),
});

router.post(
  "/create-checkout-session",
  authRequired,
  roleRequired("customer"),
  async (req, res) => {
    try {
      assertStripeConfigured();
      const parsed = createCheckoutSchema.safeParse(req.body);
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

      const amount = ride.final_fare_cents ?? ride.fare_estimate_cents;

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        success_url: SUCCESS_URL,
        cancel_url: CANCEL_URL,
        client_reference_id: String(ride.id),
        metadata: {
          ride_id: String(ride.id),
          customer_id: String(req.user.id),
        },
        line_items: [
          {
            quantity: 1,
            price_data: {
              // Currency is set by Admin Settings (app_settings.currency)
              currency: stripeCurrency(),
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

      return res.json({ url: session.url });
    } catch (e) {
      const status = e?.status || 500;
      return res.status(status).json({ error: "payment_init_failed" });
    }
  }
);

router.post("/webhook", async (req, res) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
  if (!webhookSecret) return res.status(500).send("Missing STRIPE_WEBHOOK_SECRET");

  let event;
  try {
    const sig = req.headers["stripe-signature"];
    event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);
  } catch (err) {
    if (NODE_ENV !== "production") {
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    return res.status(400).send("Webhook signature verification failed");
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const rideId = Number(
        session.metadata?.ride_id || session.client_reference_id
      );
      if (Number.isFinite(rideId)) {
        const paymentIntentId = session.payment_intent
          ? String(session.payment_intent)
          : null;

        db.prepare(
          "UPDATE rides SET payment_status='paid', stripe_payment_intent_id=? WHERE id=?"
        ).run(paymentIntentId, rideId);

        db.prepare(
          "INSERT INTO ride_events (ride_id, type, message) VALUES (?, 'payment_paid', 'Stripe payment confirmed')"
        ).run(rideId);

        const updated = db.prepare("SELECT * FROM rides WHERE id=?").get(rideId);

        try {
          const io = req.app?.locals?.io;
          if (io && updated) {
            io.to(`user:${updated.customer_id}`).emit("ride:updated", { ride: updated });
            if (updated.driver_id) {
              io.to(`driver:${updated.driver_id}`).emit("ride:updated", { ride: updated });
            }
            io.to("admin").emit("ride:updated", { ride: updated });
          }
        } catch {
          // ignore
        }
      }
    }

    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object;
      const rideId = Number(pi.metadata?.ride_id);
      if (Number.isFinite(rideId)) {
        db.prepare(
          "UPDATE rides SET payment_status='paid', stripe_payment_intent_id=? WHERE id=?"
        ).run(String(pi.id), rideId);
        db.prepare(
          "INSERT INTO ride_events (ride_id, type, message) VALUES (?, 'payment_paid', 'Stripe PaymentIntent succeeded')"
        ).run(rideId);

        const updated = db.prepare("SELECT * FROM rides WHERE id=?").get(rideId);
        try {
          const io = req.app?.locals?.io;
          if (io && updated) {
            io.to(`user:${updated.customer_id}`).emit("ride:updated", { ride: updated });
            if (updated.driver_id) {
              io.to(`driver:${updated.driver_id}`).emit("ride:updated", { ride: updated });
            }
            io.to("admin").emit("ride:updated", { ride: updated });
          }
        } catch {
          // ignore
        }
      }
    }

    if (event.type === "payment_intent.payment_failed") {
      const pi = event.data.object;
      let ride =
        db.prepare("SELECT * FROM rides WHERE stripe_payment_intent_id=?").get(String(pi.id)) ||
        null;
      if (!ride) {
        const rid = Number(pi.metadata?.ride_id);
        if (Number.isFinite(rid)) ride = db.prepare("SELECT * FROM rides WHERE id=?").get(rid);
      }
      if (ride) {
        db.prepare("UPDATE rides SET payment_status='failed' WHERE id=?").run(ride.id);
        db.prepare(
          "INSERT INTO ride_events (ride_id, type, message) VALUES (?, 'payment_failed', 'Stripe payment failed')"
        ).run(ride.id);
      }
    }

    return res.json({ received: true });
  } catch {
    return res.status(500).send("Webhook handler failure");
  }
});

// Dev-only: simulate a successful card payment for a ride.
router.post(
  "/mock-pay",
  authRequired,
  roleRequired("customer"),
  (req, res) => {
    const allow =
      process.env.ALLOW_MOCK_PAYMENTS === "1" || process.env.NODE_ENV !== "production";
    if (!allow) return res.status(404).json({ error: "not_found" });

    const rideId = Number(req.body?.ride_id);
    if (!Number.isFinite(rideId)) return res.status(400).json({ error: "invalid_ride_id" });

    const ride = db.prepare("SELECT * FROM rides WHERE id=?").get(rideId);
    if (!ride) return res.status(404).json({ error: "ride_not_found" });
    if (ride.customer_id !== req.user.id) return res.status(403).json({ error: "forbidden" });

    db.prepare(
      "UPDATE rides SET payment_status='paid', stripe_payment_intent_id=COALESCE(stripe_payment_intent_id, ?) WHERE id=?"
    ).run(`mock_pi_${Date.now()}`, rideId);

    db.prepare(
      "INSERT INTO ride_events (ride_id, type, message) VALUES (?, 'payment_paid', 'Payment simulated (dev)')"
    ).run(rideId);

    const updated = db.prepare("SELECT * FROM rides WHERE id=?").get(rideId);
    try {
      const io = req.app?.locals?.io;
      if (io && updated) {
        io.to(`user:${updated.customer_id}`).emit("ride:updated", { ride: updated });
        if (updated.driver_id) io.to(`driver:${updated.driver_id}`).emit("ride:updated", { ride: updated });
        io.to("admin").emit("ride:updated", { ride: updated });
      }
    } catch {
      // ignore
    }

    return res.json({ ok: true, ride: updated });
  }
);

export default router;

