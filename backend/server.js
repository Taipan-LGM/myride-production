import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { Server as SocketIOServer } from "socket.io";
import dotenv from "dotenv";

import { securityHeadersMiddleware } from "./securityHeaders.js";
import { initDatabase, db } from "./database.js";
import { ensureAdminBootstrap, socketAuthMiddleware, authRequired, roleRequired } from "./auth.js";

import usersRouter from "./routes/users.js";
import ridesRouter from "./routes/rides.js";
import paymentsRouter from "./routes/payments.js";
import adminRouter from "./routes/admin.js";
import applicationsRouter from "./routes/applications.js";
import driverAuthRouter from "./routes/driverAuth.js";
import geocodeRouter from "./routes/geocode.js";
import settingsRouter from "./routes/settings.js";
import platformSettingsRouter from "./routes/platformSettings.js";
import payoutsRouter from "./routes/payouts.js";
import { createRidePaymentIntent } from "./services/ridePaymentIntent.js";

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || "development";
const HOST = process.env.HOST || "0.0.0.0";

function parseOrigins() {
  const raw =
    process.env.APP_ORIGINS ||
    process.env.APP_ORIGIN ||
    `http://localhost:${PORT},http://127.0.0.1:${PORT}`;

  const fromEnv = String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const extra = String(process.env.EXTRA_APP_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Render injects this for web services; include it so CORS/Socket.io work without
  // duplicating the public URL in APP_ORIGINS.
  const renderUrl = process.env.RENDER_EXTERNAL_URL?.trim().replace(/\/$/, "");

  const merged = [...fromEnv, ...extra];
  if (renderUrl) merged.push(renderUrl);

  const seen = new Set();
  return merged.filter((o) => {
    if (seen.has(o)) return false;
    seen.add(o);
    return true;
  });
}

const ALLOWED_ORIGINS = parseOrigins();

function originAllowed(origin) {
  if (!origin) return true; // non-browser clients
  return ALLOWED_ORIGINS.includes(origin);
}

function guessLanIpv4() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return null;
}

const app = express();
const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: (origin, cb) => cb(null, originAllowed(origin)),
    methods: ["GET", "POST"],
    credentials: true,
  },
});

app.locals.io = io;

app.set("trust proxy", 1);

app.use(securityHeadersMiddleware(NODE_ENV));
app.use(
  cors({
    origin: (origin, cb) => cb(null, originAllowed(origin)),
    credentials: true,
  })
);

// Stripe webhooks need the raw body; we capture it here on the /api/payments/webhook path.
app.use(
  "/api/payments/webhook",
  express.raw({
    type: "application/json",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// Zoneless webhooks also need raw body for signature verification.
app.use(
  "/api/payouts/webhook",
  express.raw({
    type: "application/json",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      // keep for debugging; only webhook uses rawBody
      req.jsonRawBody = buf;
    },
  })
);

app.use(morgan(NODE_ENV === "production" ? "combined" : "dev"));
app.use(
  rateLimit({
    windowMs: 60_000,
    limit: 180,
    standardHeaders: true,
    legacyHeaders: false,
    // Stripe webhooks can arrive in bursts; do not throttle signature verification.
    skip: (req) =>
      req.path === "/api/payments/webhook" ||
      (req.originalUrl && req.originalUrl.startsWith("/api/payments/webhook")) ||
      req.path === "/api/payouts/webhook" ||
      (req.originalUrl && req.originalUrl.startsWith("/api/payouts/webhook")),
  })
);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, env: NODE_ENV });
});

app.post(
  "/api/create-ride-payment",
  authRequired,
  roleRequired("customer"),
  createRidePaymentIntent
);

app.use("/api/users", usersRouter);
app.use("/api/rides", ridesRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/admin", adminRouter);
app.use("/api/applications", applicationsRouter);
app.use("/api/driver-auth", driverAuthRouter);
app.use("/api/geocode", geocodeRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/platform-settings", platformSettingsRouter);
app.use("/api/payouts", payoutsRouter);

// Serve static logos (repo root /Logos) at /logos/...
app.use("/logos", express.static(path.resolve(process.cwd(), "Logos")));

// Serve frontend (single site)
const frontendDir = path.resolve(process.cwd(), "frontend");
app.use(express.static(frontendDir));
app.get("*", (_req, res) => {
  res.sendFile(path.join(frontendDir, "index.html"));
});

io.use(socketAuthMiddleware);

io.on("connection", (socket) => {
  const { user } = socket.data;
  if (!user) return;

  socket.join(`user:${user.id}`);
  socket.join(`role:${user.role}`);
  if (user.role === "driver") socket.join(`driver:${user.id}`);
  if (user.role === "customer") socket.join(`customer:${user.id}`);
  if (user.role === "admin") socket.join("admin");

  socket.emit("hello", {
    user: { id: user.id, role: user.role, email: user.email, name: user.name },
  });

  socket.on("driver:setOnline", (payload) => {
    if (user.role !== "driver") return;
    const online = payload?.online ? 1 : 0;
    db.prepare(
      "UPDATE driver_profiles SET online=?, updated_at=datetime('now') WHERE user_id=?"
    ).run(online, user.id);
    socket.emit("driver:onlineStatus", { online: Boolean(online) });
  });

  socket.on("driver:updateLocation", (payload) => {
    if (user.role !== "driver") return;
    const lat = Number(payload?.lat);
    const lng = Number(payload?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    db.prepare(
      "UPDATE driver_profiles SET lat=?, lng=?, updated_at=datetime('now') WHERE user_id=?"
    ).run(lat, lng, user.id);

    db.prepare(
      "INSERT INTO driver_locations (driver_user_id, ride_id, lat, lng) VALUES (?, NULL, ?, ?)"
    ).run(user.id, lat, lng);

    io.to(`driver:${user.id}`).emit("driver:locationUpdated", { lat, lng });
  });
});

function assertProductionConfig() {
  if (NODE_ENV !== "production") return;
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "JWT_SECRET must be set to a strong secret (32+ characters) in production"
    );
  }
}

function logProductionStripeWarnings() {
  if (NODE_ENV !== "production") return;
  const key = process.env.STRIPE_SECRET_KEY || "";
  const allowTest =
    process.env.STRIPE_ALLOW_TEST_KEYS_IN_PRODUCTION === "1" ||
    process.env.STRIPE_ALLOW_TEST_IN_PRODUCTION === "1";
  if (!key.startsWith("sk_test")) return;
  if (allowTest) {
    // eslint-disable-next-line no-console
    console.warn(
      "[my-ride] STRIPE_ALLOW_TEST_KEYS_IN_PRODUCTION=1: accepting test-mode Stripe keys in production (demo only)."
    );
    return;
  }
  // eslint-disable-next-line no-console
  console.warn(
    "[my-ride] WARNING: STRIPE_SECRET_KEY is test mode (sk_test_...) while NODE_ENV=production. " +
      "Use live keys (sk_live_...) for real charges. To silence this for a demo deploy, set " +
      "STRIPE_ALLOW_TEST_KEYS_IN_PRODUCTION=1."
  );
}

async function boot() {
  assertProductionConfig();
  logProductionStripeWarnings();

  const schemaPath = path.resolve(process.cwd(), "db", "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");
  initDatabase(schema);

  await ensureAdminBootstrap();

  server.listen(PORT, HOST, () => {
    const lan = guessLanIpv4();
    // eslint-disable-next-line no-console
    console.log(`My Ride listening on http://${HOST}:${PORT}`);
    // eslint-disable-next-line no-console
    console.log(`Open locally: http://localhost:${PORT}`);
    if (lan) {
      // eslint-disable-next-line no-console
      console.log(`On your phone (same Wi‑Fi): http://${lan}:${PORT}`);
    }
  });
}

boot().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal boot error:", err);
  process.exit(1);
});

