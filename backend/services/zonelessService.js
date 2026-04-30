let ZonelessCtor = null;

export async function getZonelessClient() {
  const key = process.env.ZONELESS_API_KEY || "";
  const baseUrl = (process.env.ZONELESS_BASE_URL || "").trim() || "http://localhost";
  if (!key) {
    const err = new Error("zoneless_not_configured");
    err.status = 500;
    throw err;
  }
  if (!ZonelessCtor) {
    try {
      const mod = await import("@zoneless/node");
      ZonelessCtor = mod.Zoneless;
    } catch {
      const err = new Error("zoneless_sdk_missing");
      err.status = 501;
      throw err;
    }
  }
  return new ZonelessCtor(key, baseUrl);
}

export function zonelessWebhookSecret() {
  return process.env.ZONELESS_WEBHOOK_SECRET || "";
}
