import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { authRequired } from "../../middleware/auth.js";
import { errorHandler } from "../../middleware/errorHandler.js";
import {
  paymentIntentBodySchema,
  cashPaymentBodySchema,
} from "../../validation/paymentSchemas.js";
import { createValidationApp, requestJson, startServer } from "../helpers/httpTest.js";

test("POST /api/payments/create-intent returns AUTH_001 without token", async () => {
  const app = express();
  app.post("/api/payments/create-intent", authRequired, (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);

  const { port, close } = await startServer(app);
  try {
    const res = await requestJson(port, {
      method: "POST",
      path: "/api/payments/create-intent",
      body: { ride_id: 1 },
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, "AUTH_001");
  } finally {
    await close();
  }
});

test("payment intent schema rejects missing ride_id", async () => {
  const app = createValidationApp({
    method: "post",
    path: "/create-intent",
    schema: paymentIntentBodySchema,
  });
  const { port, close } = await startServer(app);
  try {
    const res = await requestJson(port, {
      method: "POST",
      path: "/create-intent",
      body: {},
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "VAL_001");
  } finally {
    await close();
  }
});

test("payment intent schema rejects negative amount", async () => {
  const app = createValidationApp({
    method: "post",
    path: "/create-intent",
    schema: paymentIntentBodySchema,
  });
  const { port, close } = await startServer(app);
  try {
    const res = await requestJson(port, {
      method: "POST",
      path: "/create-intent",
      body: { ride_id: 1, amount: -10 },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "VAL_001");
  } finally {
    await close();
  }
});

test("cash payment schema requires ride_id", async () => {
  const app = createValidationApp({
    method: "post",
    path: "/cash",
    schema: cashPaymentBodySchema,
  });
  const { port, close } = await startServer(app);
  try {
    const res = await requestJson(port, {
      method: "POST",
      path: "/cash",
      body: { amount: 150 },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "VAL_001");
  } finally {
    await close();
  }
});
