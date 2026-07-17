import express from "express";
import { createRidePaymentIntent as createRidePaymentIntentAction } from "../actions/paymentActions.js";
import { sendSuccess } from "../lib/apiResponse.js";

/**
 * Express handler: POST /api/payments/create-ride-payment
 * (also mounted at POST /api/create-ride-payment)
 */
export async function createRidePaymentIntent(req, res, next) {
  try {
    const rideId = Number(req.body?.ride_id);
    const result = await createRidePaymentIntentAction(req.user.id, rideId);
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
