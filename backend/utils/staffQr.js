import { z } from "zod";
import crypto from "crypto";

// My Ride staff QR card token (separate from Logicline driver `ll-...` ids).
const DEFAULT_STAFF_EXTERNAL_ID_RE = /^mr-staff-[a-z0-9][a-z0-9-]{2,63}$/i;

export const STAFF_ROLES = ["operator", "supervisor", "manager"];
export const OFFICE_ROLES = ["admin", ...STAFF_ROLES];

export function externalStaffIdRegex() {
  const raw = process.env.STAFF_EXTERNAL_ID_REGEX;
  if (!raw) return DEFAULT_STAFF_EXTERNAL_ID_RE;
  return new RegExp(raw);
}

export const externalStaffIdSchema = z
  .string()
  .trim()
  .regex(externalStaffIdRegex(), "invalid_staff_qr_id_format");

export function staffRoleSchema() {
  return z.enum(STAFF_ROLES);
}

export function generateStaffExternalId(role) {
  const slug =
    role === "operator" ? "op" : role === "supervisor" ? "sup" : role === "manager" ? "mgr" : "st";
  const rand = crypto.randomBytes(4).toString("hex");
  return `mr-staff-${slug}-${rand}`;
}

export function staffQrPayload(externalStaffId) {
  return JSON.stringify({ external_staff_id: externalStaffId });
}
