import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { authRequired } from "../../middleware/auth.js";
import { errorHandler } from "../../middleware/errorHandler.js";
import { driverLocationBodySchema, driverStatusBodySchema } from "../../validation/driverSchemas.js";
import { validateBody } from "../../middleware/validate.js";
import { createValidationApp, requestJson, startServer } from "../helpers/httpTest.js";

test("GET /api/drivers/profile returns AUTH_001 without token", async () => {
  const app = express();
  app.get("/api/drivers/profile", authRequired, (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);

  const { port, close } = await startServer(app);
  try {
    const res = await requestJson(port, { path: "/api/drivers/profile" });
    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, "AUTH_001");
  } finally {
    await close();
  }
});

test("POST driver location validation rejects invalid latitude", async () => {
  const app = createValidationApp({
    method: "post",
    path: "/location",
    schema: driverLocationBodySchema,
  });
  const { port, close } = await startServer(app);
  try {
    const res = await requestJson(port, {
      method: "POST",
      path: "/location",
      body: { lat: 100, lng: 25.57 },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "VAL_001");
    assert.ok(Array.isArray(res.body.error.details));
  } finally {
    await close();
  }
});

test("POST driver location validation accepts valid coordinates", async () => {
  const app = express();
  app.use(express.json());
  app.post("/location", validateBody(driverLocationBodySchema), (req, res) => {
    res.json({ success: true, data: req.body });
  });
  app.use(errorHandler);

  const { port, close } = await startServer(app);
  try {
    const res = await requestJson(port, {
      method: "POST",
      path: "/location",
      body: { lat: -33.9249, lng: 25.5701, bearing: 180, speed: 30 },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.lat, -33.9249);
  } finally {
    await close();
  }
});

test("PUT driver status validation rejects invalid status", async () => {
  const app = createValidationApp({
    method: "put",
    path: "/status",
    schema: driverStatusBodySchema,
  });
  const { port, close } = await startServer(app);
  try {
    const res = await requestJson(port, {
      method: "PUT",
      path: "/status",
      body: { status: "invalid_status" },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "VAL_001");
  } finally {
    await close();
  }
});
