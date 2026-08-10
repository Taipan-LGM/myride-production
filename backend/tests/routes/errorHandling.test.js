import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import { authRequired } from "../../middleware/auth.js";
import { errorHandler } from "../../middleware/errorHandler.js";
import { nearbyDriversQuerySchema } from "../../validation/rideSchemas.js";
import { validateQuery } from "../../middleware/validate.js";
import { requestJson, startServer } from "../helpers/httpTest.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";

function signBadToken() {
  return jwt.sign({ sub: "not-a-number", role: "customer" }, JWT_SECRET, {
    expiresIn: "1h",
  });
}

test("invalid bearer token returns AUTH_002", async () => {
  const app = express();
  app.get("/secure", authRequired, (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);

  const { port, close } = await startServer(app);
  try {
    const res = await requestJson(port, {
      path: "/secure",
      headers: { Authorization: `Bearer ${signBadToken()}` },
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, "AUTH_002");
  } finally {
    await close();
  }
});

test("nearby query validation rejects invalid latitude", async () => {
  const app = express();
  app.get("/nearby", validateQuery(nearbyDriversQuerySchema), (req, res) => {
    res.json({ success: true, data: req.query });
  });
  app.use(errorHandler);

  const { port, close } = await startServer(app);
  try {
    const res = await requestJson(port, {
      path: "/nearby?lat=200&lng=25.57",
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "VAL_001");
    assert.ok(res.body.error.details?.length > 0);
  } finally {
    await close();
  }
});
