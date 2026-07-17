import express from "express";
import { authRequired, roleRequired } from "../middleware/auth.js";
import { sendSuccess } from "../lib/apiResponse.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import {
  capturePaymentBodySchema,
  cashPaymentBodySchema,
  createCheckoutBodySchema,
  mockPayBodySchema,
  paymentHistoryQuerySchema,
  paymentIntentBodySchema,
  refundPaymentBodySchema,
  withdrawalBodySchema,
} from "../validation/index.js";
import {
  capturePayment,
  createCheckoutSession,
  createRidePaymentIntent,
  getPaymentHistory,
  getStripePublicConfig,
  markRidePaid,
  markRidePaymentFailed,
  mockPayAllowed,
  recordCashPayment,
  recordMockPayment,
  refundRidePayment,
  requestWithdrawal,
  stripe,
} from "../actions/paymentActions.js";
import { db } from "../database.js";

const router = express.Router();
const NODE_ENV = process.env.NODE_ENV || "development";

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

async function createIntentHandler(req, res, next) {
  try {
    const result = await createRidePaymentIntent(req.user.id, req.body.ride_id);
    return sendSuccess(res, {
      payment_id: result.payment_intent_id,
      client_secret: result.client_secret,
      payment_intent_id: result.payment_intent_id,
      amount_cents: result.amount_cents,
      currency: result.currency,
      owner_commission_cents: result.owner_commission_cents,
      driver_earnings_cents: result.driver_earnings_cents,
    });
  } catch (err) {
    next(err);
  }
}

router.get("/public-config", (_req, res) => {
  return sendSuccess(res, getStripePublicConfig());
});

router.post(
  "/create-intent",
  authRequired,
  roleRequired("customer"),
  validateBody(paymentIntentBodySchema),
  createIntentHandler
);
router.post(
  "/create-ride-payment",
  authRequired,
  roleRequired("customer"),
  validateBody(paymentIntentBodySchema),
  createIntentHandler
);

router.post(
  "/create-checkout-session",
  authRequired,
  roleRequired("customer"),
  validateBody(createCheckoutBodySchema),
  async (req, res, next) => {
    try {
      const result = await createCheckoutSession(req.user.id, req.body.ride_id, {
        successUrl: SUCCESS_URL,
        cancelUrl: CANCEL_URL,
      });
      return sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/capture",
  authRequired,
  roleRequired("driver"),
  validateBody(capturePaymentBodySchema),
  async (req, res, next) => {
    try {
      const result = await capturePayment(
        req.body.payment_intent_id,
        req.body.ride_id,
        req.user.id,
        { io: req.app.locals.io }
      );
      return sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/refund",
  authRequired,
  roleRequired("admin"),
  validateBody(refundPaymentBodySchema),
  async (req, res, next) => {
    try {
      const rideId = req.body.ride_id ?? req.body.payment_id;
      const amountCents = req.body.amount
        ? Math.round(req.body.amount * 100)
        : null;
      const result = await refundRidePayment(rideId, {
        amountCents,
        reason: req.body.reason,
      });
      return sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/cash",
  authRequired,
  roleRequired("driver"),
  validateBody(cashPaymentBodySchema),
  (req, res, next) => {
    try {
      const amountCents =
        req.body.amount_cents ??
        (req.body.amount != null ? Math.round(req.body.amount * 100) : null);
      const result = recordCashPayment(req.user.id, req.body.ride_id, amountCents);
      return sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  "/history",
  authRequired,
  validateQuery(paymentHistoryQuerySchema),
  (req, res, next) => {
    try {
      let role = req.query.role || req.user.role;
      if (role === "rider") role = "customer";
      if (!["customer", "driver"].includes(role)) role = "customer";
      const result = getPaymentHistory(req.user.id, role, req.query);
      return sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/withdraw",
  authRequired,
  roleRequired("driver"),
  validateBody(withdrawalBodySchema),
  (req, res, next) => {
    try {
      const result = requestWithdrawal(req.user.id, req.body);
      return sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/mock-pay",
  authRequired,
  roleRequired("customer"),
  validateBody(mockPayBodySchema),
  (req, res, next) => {
    try {
      if (!mockPayAllowed()) {
        return res.status(404).json({
          success: false,
          error: { code: "RES_001", message: "Not found" },
        });
      }
      const ride = recordMockPayment(req.user.id, req.body.ride_id, {
        io: req.app.locals.io,
      });
      return sendSuccess(res, { ride });
    } catch (err) {
      next(err);
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

  const io = req.app?.locals?.io;

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const rideId = Number(session.metadata?.ride_id || session.client_reference_id);
      if (Number.isFinite(rideId)) {
        const paymentIntentId = session.payment_intent
          ? String(session.payment_intent)
          : null;
        markRidePaid(rideId, paymentIntentId, { io });
      }
    }

    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object;
      const rideId = Number(pi.metadata?.ride_id);
      if (Number.isFinite(rideId)) {
        markRidePaid(rideId, String(pi.id), { io });
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
      if (ride) markRidePaymentFailed(ride.id, { io });
    }

    if (event.type === "charge.refunded") {
      const charge = event.data.object;
      const rideId = Number(charge.metadata?.ride_id);
      if (Number.isFinite(rideId)) {
        db.prepare("UPDATE rides SET payment_status='refunded' WHERE id=?").run(rideId);
      }
    }

    return res.json({ received: true });
  } catch {
    return res.status(500).send("Webhook handler failure");
  }
});

export default router;
