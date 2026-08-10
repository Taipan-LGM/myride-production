import { test } from "node:test";
import assert from "node:assert/strict";

test("paymentActions module loads without STRIPE_SECRET_KEY (Render boot)", async () => {
  const prev = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  try {
    const mod = await import("../../actions/paymentActions.js");
    assert.equal(typeof mod.createRidePaymentIntent, "function");
    assert.equal(typeof mod.getStripe, "function");
  } finally {
    if (prev === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = prev;
  }
});
