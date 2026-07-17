import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { db } from "./database.js";
import { AuthError } from "./errors/index.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

export function hashPassword(plain) {
  const salt = bcrypt.genSaltSync(10);
  return bcrypt.hashSync(plain, salt);
}

export function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

export function signToken(user) {
  return jwt.sign(
    { sub: String(user.id), role: user.role, email: user.email },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

export function authRequired(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const parts = auth.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") {
      return next(new AuthError("AUTH_001"));
    }
    const token = parts[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = Number(decoded.sub);
    if (!Number.isFinite(userId)) {
      return next(new AuthError("AUTH_002"));
    }

    const user = db
      .prepare("SELECT id, role, email, name, created_at FROM users WHERE id=?")
      .get(userId);
    if (!user) return next(new AuthError("AUTH_002"));

    req.user = user;
    next();
  } catch (err) {
    if (err?.name === "TokenExpiredError") {
      return next(new AuthError("AUTH_003"));
    }
    return next(new AuthError("AUTH_002"));
  }
}

export function roleRequired(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(new AuthError("AUTH_001"));
    if (!roles.includes(req.user.role)) {
      return next(new AuthError("AUTH_006"));
    }
    next();
  };
}

export async function ensureAdminBootstrap() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME || "Admin";

  if (!email || !password) return;

  const existing = db
    .prepare("SELECT id FROM users WHERE email=? AND role='admin'")
    .get(email.trim().toLowerCase());
  if (existing) return;

  const password_hash = hashPassword(password);

  db.prepare(
    "INSERT INTO users (role, email, password_hash, name) VALUES ('admin', ?, ?, ?)"
  ).run(email.trim().toLowerCase(), password_hash, name.trim());
}

export function socketAuthMiddleware(socket, next) {
  try {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.replace("Bearer ", "");

    if (!token) {
      return next(new Error("missing_token"));
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = Number(decoded.sub);
    if (!Number.isFinite(userId)) {
      return next(new Error("invalid_token"));
    }

    const user = db
      .prepare("SELECT id, role, email, name FROM users WHERE id=?")
      .get(userId);

    if (!user) return next(new Error("user_not_found"));

    socket.data.user = user;
    next();
  } catch {
    next(new Error("invalid_or_expired_token"));
  }
}

