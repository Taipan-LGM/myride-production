import { db } from "../database.js";

function haversineMeters(aLat, aLng, bLat, bLng) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function osrmBaseUrl() {
  const raw = String(process.env.OSRM_BASE_URL || "").trim();
  return raw.replace(/\/$/, "") || "https://router.project-osrm.org";
}

/**
 * Driving distance via OSRM (road network). Returns meters or null.
 */
export async function osrmRouteMeters(plat, pln, dla, dln) {
  if (![plat, pln, dla, dln].every(Number.isFinite)) return null;
  try {
    const base = osrmBaseUrl();
    const url = `${base}/route/v1/driving/${pln},${plat};${dln},${dla}?overview=false`;
    const r = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!r.ok) return null;
    const j = await r.json();
    const m = j.routes?.[0]?.distance;
    return Number.isFinite(m) && m > 0 ? m : null;
  } catch {
    return null;
  }
}

/**
 * CartTrack (or compatible) HTTP API — placeholder integration.
 * Admin sets full endpoint URL; API key via env `CARTTRACK_API_KEY`.
 * Request body: { pickup: {lat,lng}, dropoff: {lat,lng} }
 * Response: tries distance_meters | distanceMeters | data.distance_meters | numeric distance (meters).
 */
export async function carttrackRouteMeters(plat, pln, dla, dln) {
  const apiKey = String(process.env.CARTTRACK_API_KEY || "").trim();
  const row = db
    .prepare("SELECT carttrack_api_base_url FROM app_settings WHERE id=1")
    .get();
  const endpoint = String(row?.carttrack_api_base_url || "").trim();
  if (!apiKey || !endpoint) return null;
  if (![plat, pln, dla, dln].every(Number.isFinite)) return null;

  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        pickup: { lat: plat, lng: pln },
        dropoff: { lat: dla, lng: dln },
      }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const m =
      j.distance_meters ??
      j.distanceMeters ??
      j.distance_metres ??
      j?.data?.distance_meters ??
      j?.result?.distance_meters;
    return Number.isFinite(m) && m > 0 ? m : null;
  } catch {
    return null;
  }
}

/**
 * Resolves trip length in meters for fare pricing (most accurate option first).
 * Sources: carttrack (with OSRM + haversine fallback), osrm (with haversine fallback), straight_line only.
 */
export async function resolveFareDistanceMeters(plat, pln, dla, dln) {
  const row = db
    .prepare("SELECT fare_distance_source FROM app_settings WHERE id=1")
    .get();
  const source = String(row?.fare_distance_source || "osrm").toLowerCase();
  const fallback = () => haversineMeters(plat, pln, dla, dln);

  if (source === "straight_line") {
    return fallback();
  }

  if (source === "carttrack") {
    const ct = await carttrackRouteMeters(plat, pln, dla, dln);
    if (ct != null) return ct;
    const os = await osrmRouteMeters(plat, pln, dla, dln);
    if (os != null) return os;
    return fallback();
  }

  const os = await osrmRouteMeters(plat, pln, dla, dln);
  if (os != null) return os;
  return fallback();
}
