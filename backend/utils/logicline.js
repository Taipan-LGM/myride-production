import { z } from "zod";

// Logicline external driver id token used inside QR payloads and typed IDs.
// Default strict pattern (adjust via env if Logicline uses a different scheme):
// - ll-<alphanumeric/dash>
const DEFAULT_EXTERNAL_DRIVER_ID_RE = /^ll-[a-z0-9][a-z0-9-]{2,63}$/i;

export function externalDriverIdRegex() {
  const raw = process.env.LOGICLINE_EXTERNAL_ID_REGEX;
  if (!raw) return DEFAULT_EXTERNAL_DRIVER_ID_RE;
  return new RegExp(raw);
}

export const externalDriverIdSchema = z
  .string()
  .trim()
  .regex(externalDriverIdRegex(), "invalid_logicline_driver_id_format");
