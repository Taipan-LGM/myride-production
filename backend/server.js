import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { Server as SocketIOServer } from "socket.io";
import dotenv from "dotenv";

import { initDatabase, db } from "./database.js";
import { ensureAdminBootstrap, socketAuthMiddleware } from "./auth.js";

import usersRouter from "./routes/users.js";
import ridesRouter from "./routes/rides.js";
import paymentsRouter from "./routes/payments.js";
import adminRouter from "./routes/admin.js";
import applicationsRouter from "./routes/applications.js";
import driverAuthRouter from "./routes/driverAuth.js";

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || "development";
const HOST = process.env.HOST || "0.0.0.0";

function parseOrigins() {
  const raw =
    process.env.APP_ORIGINS ||
    process.env.APP_ORIGIN ||
    `http://localhost:${PORT},http://127.0.0.1:${PORT}`;

  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
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

app.use(helmet());
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
  })
);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, env: NODE_ENV });
});

app.use("/api/users", usersRouter);
app.use("/api/rides", ridesRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/admin", adminRouter);
app.use("/api/applications", applicationsRouter);
app.use("/api/driver-auth", driverAuthRouter);

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

async function boot() {
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

