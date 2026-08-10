import express from "express";
import rateLimit from "express-rate-limit";
import {
  getGeocodeConfig,
  geocodeSuggestUnified,
  suggestNominatim,
  reverseGeocode,
  googlePlaceDetails,
  googleGeocodeForward,
  recordFailedAddressAttempt,
  isGeocodeZaOnlyEnabled,
  placeIsInSouthAfrica,
  localDevMapCenterPlace,
} from "../services/geocodeService.js";

const router = express.Router();

const USER_AGENT_IP = "MyRide/1.0.3 (server ip-hint; contact via README)";

const limiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

function queryTooShort(q) {
  if (q.length < 2) return true;
  if (q.length >= 3) return false;
  return !/^\d/.test(q);
}

router.get("/config", (_req, res) => {
  res.json(getGeocodeConfig());
});

router.get("/reverse", limiter, async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: "invalid_coordinates" });
  }
  try {
    const place = await reverseGeocode(lat, lng);
    return res.json(place);
  } catch {
    return res.status(502).json({ error: "reverse_failed" });
  }
});

/** Rough pickup hint when browser geolocation is unavailable (LAN HTTP, denied, etc.). Uses client IP → coarse lat/lng → reverse geocode. */
router.get("/ip-hint", limiter, async (req, res) => {
  let ip = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  if (!ip) ip = String(req.socket.remoteAddress || "").trim();
  ip = ip.replace(/^::ffff:/i, "");

  const isLoopback =
    !ip ||
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip.startsWith("127.") ||
    ip === "unknown";

  if (isLoopback) {
    try {
      const dev = await localDevMapCenterPlace();
      if (dev) {
        return res.json({
          ...dev,
          ip_hint: false,
        });
      }
    } catch {
      /* fall through */
    }
    return res.status(400).json({
      error: "no_public_ip",
      message:
        "Local dev: add Country + City in Admin → Settings (or set DEV_GEO_FALLBACK_LAT/LNG in .env), then tap Approximate again — or type your pickup.",
    });
  }

  try {
    const url = `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,lat,lon,query`;
    const r = await fetch(url, { headers: { "User-Agent": USER_AGENT_IP } });
    if (!r.ok) return res.status(502).json({ error: "ip_lookup_http" });
    const j = await r.json();
    if (j.status !== "success" || !Number.isFinite(Number(j.lat))) {
      return res.status(502).json({
        error: "ip_lookup_failed",
        message: j.message || "geoip_unavailable",
      });
    }
    const place = await reverseGeocode(Number(j.lat), Number(j.lon));
    return res.json({
      ...place,
      approximate: true,
      ip_hint: true,
      geoip_query: j.query || ip,
    });
  } catch {
    return res.status(502).json({ error: "ip_hint_failed" });
  }
});

router.get("/forward", limiter, async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 4) {
    return res.status(400).json({ error: "query_too_short" });
  }
  try {
    const zaOnly = isGeocodeZaOnlyEnabled();
    const place = await googleGeocodeForward(q, {
      restrictCountry: zaOnly ? "za" : "",
    });
    if (!place) {
      return res.status(404).json({
        error: "forward_geocode_not_found",
        message: zaOnly
          ? "Could not resolve that Plus Code or address within South Africa."
          : "Could not resolve that address or Plus Code.",
      });
    }
    if (zaOnly && !placeIsInSouthAfrica(place)) {
      return res.status(400).json({
        error: "forward_outside_za",
        message:
          "That location is outside South Africa. Turn off ZA-only in Admin Settings, or use a South African Plus Code / address.",
      });
    }
    return res.json({ place });
  } catch (e) {
    if (String(e.message || "").includes("google_not_configured")) {
      return res.status(503).json({ error: "google_not_configured" });
    }
    return res.status(502).json({ error: "forward_geocode_failed" });
  }
});

router.get("/google-place", limiter, async (req, res) => {
  const place = String(req.query.place || "").trim();
  const userInput = String(req.query.user_input ?? "").trim();
  if (!place) return res.status(400).json({ error: "missing_place" });
  try {
    const details = await googlePlaceDetails(place);
    return res.json(details);
  } catch (e) {
    if (String(e.message || "").includes("google_not_configured")) {
      return res.status(503).json({ error: "google_not_configured" });
    }
    if (String(e.message || "").includes("google_place_no_street_number")) {
      const googlePrediction = String(e.google_prediction ?? "").trim();
      const ts = Date.now();
      const failed_address_attempts = {
        user_input: userInput,
        google_prediction: googlePrediction,
        missing_reason: "street_number",
        timestamp: ts,
      };
      recordFailedAddressAttempt(failed_address_attempts);
      return res.status(400).json({
        error: "no_verified_street_number",
        message:
          "The exact number isn't found in Google's database for this place. Choose a fallback below, drop a pin on the map, or enter a Plus Code.",
        nearest_verified: e.nearestVerified ?? null,
        failed_address_attempts,
      });
    }
    return res.status(502).json({ error: "google_place_failed" });
  }
});

router.get("/suggest", limiter, async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (queryTooShort(q)) return res.json({ suggestions: [] });

  const provider =
    String(req.query.provider || "").toLowerCase().trim() || "unified";

  try {
    let suggestions;
    if (provider === "nominatim") {
      suggestions = await suggestNominatim(q, req.query);
    } else {
      suggestions = await geocodeSuggestUnified(q, req.query);
    }
    return res.json({ suggestions });
  } catch {
    return res.status(502).json({ error: "geocode_request_failed" });
  }
});

export default router;
