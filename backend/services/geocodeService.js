import { db } from "../database.js";
import {
  emptyComponents,
  fromNominatim,
  fromGoogleComponents,
} from "../utils/addressComponents.js";

const USER_AGENT = "MyRide/1.0.1 (contact: see README; demo geocoder)";

/** OSM Nominatim usage policy: ~1 request/second — serialize outbound calls. */
const NOMINATIM_MIN_INTERVAL_MS = Number(
  process.env.NOMINATIM_MIN_INTERVAL_MS || 1100
);

let nominatimGate = Promise.resolve();

function nominatimSequential(fn) {
  nominatimGate = nominatimGate.then(async () => {
    await new Promise((r) => setTimeout(r, NOMINATIM_MIN_INTERVAL_MS));
    return fn();
  });
  return nominatimGate;
}

async function nominatimFetch(url) {
  return nominatimSequential(async () => {
    const r = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
    });
    if (!r.ok) return [];
    const json = await r.json();
    return Array.isArray(json) ? json : [];
  });
}

async function nominatimFetchJson(url) {
  return nominatimSequential(async () => {
    const r = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
    });
    if (!r.ok) return null;
    return await r.json();
  });
}

export function getGeocodeConfig() {
  const key = process.env.GOOGLE_PLACES_API_KEY || "";
  const raw = (process.env.GEOCODE_PROVIDER || "auto").toLowerCase().trim();
  let provider = raw;
  if (provider === "auto") {
    provider = key ? "google" : "nominatim";
  }
  if (provider === "google" && !key) provider = "nominatim";

  return {
    provider,
    googleConfigured: Boolean(key),
    nominatimMinIntervalMs: NOMINATIM_MIN_INTERVAL_MS,
  };
}

/** Reverse geocode: auto uses Google when key is set (same key as Geocoding REST if APIs enabled). */
function getReverseProvider() {
  const key = process.env.GOOGLE_PLACES_API_KEY || "";
  const raw = (process.env.GEOCODE_REVERSE_PROVIDER || "auto")
    .toLowerCase()
    .trim();
  let p = raw;
  if (p === "auto") p = key ? "google" : "nominatim";
  if (p === "google" && !key) p = "nominatim";
  return p;
}

function adaptGoogleGeocodeLegacyComponents(components) {
  if (!Array.isArray(components)) return [];
  return components.map((c) => ({
    longText: c.long_name,
    shortText: c.short_name,
    types: c.types,
  }));
}

async function googleReverseGeocode(lat, lng) {
  const key = process.env.GOOGLE_PLACES_API_KEY || "";
  if (!key) return null;
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("latlng", `${Number(lat)},${Number(lng)}`);
  url.searchParams.set("key", key);
  const r = await fetch(url);
  if (!r.ok) return null;
  const j = await r.json();
  if (j.status !== "OK" || !j.results?.length) return null;
  const res = j.results[0];
  const loc = res.geometry?.location;
  if (loc == null || loc.lat == null || loc.lng == null) return null;
  const components = fromGoogleComponents(
    adaptGoogleGeocodeLegacyComponents(res.address_components),
    res.formatted_address
  );
  return {
    label: res.formatted_address,
    lat: Number(loc.lat),
    lng: Number(loc.lng),
    components,
    provider: "google",
    needsDetails: false,
    placeId: res.place_id || null,
  };
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normHouse(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .trim();
}

function leadingHouseToken(q) {
  const first = String(q || "")
    .trim()
    .split(/\s+/)[0];
  if (!first || !/^\d/.test(first)) return null;
  if (/^\d+(?:st|nd|rd|th)$/i.test(first)) return null;
  return first;
}

function scoreRow(row, leadToken, userWantsHouse) {
  let s = Number(row.importance) || 0;
  const dn = String(row.display_name || "").toLowerCase();
  const addr = row.address || {};
  const hn = String(addr.house_number || "").toLowerCase();
  const cls = String(row.class || "");
  const typ = String(row.type || "");
  const atype = String(row.addresstype || "");

  if (leadToken) {
    const n = leadToken.toLowerCase();
    const nNorm = normHouse(n);
    const hnNorm = normHouse(hn);
    const re = new RegExp(`(^|[\\s,])${escapeRegex(n)}([\\s,]|$)`, "i");
    if (re.test(dn)) s += 8;
    if (hnNorm && (hnNorm === nNorm || hnNorm.startsWith(nNorm))) s += 60;
    if (hnNorm && nNorm.startsWith(hnNorm)) s += 55;
  }

  if (userWantsHouse && leadToken) {
    const highwayRoad = cls === "highway" || atype === "road";
    const hasHouse = Boolean(addr.house_number);
    const specificPlace =
      typ === "house" ||
      typ === "building" ||
      cls === "building" ||
      atype === "building" ||
      atype === "house";

    if (specificPlace && hasHouse) s += 35;
    if (specificPlace && !hasHouse) s += 12;
    if (highwayRoad && !hasHouse) s -= 45;
  }

  const pr = Number(row.place_rank) || 0;
  if (pr >= 28 && pr <= 31) s += 4;

  return s;
}

function mergeAndRank(rows, q) {
  const leadToken = leadingHouseToken(q);
  const userWantsHouse = Boolean(leadToken);
  const byPlace = new Map();
  for (const row of rows) {
    const pid = row.place_id ?? `${row.lat}:${row.lon}`;
    if (!byPlace.has(pid)) byPlace.set(pid, row);
  }
  const merged = [...byPlace.values()];
  merged.sort(
    (a, b) => scoreRow(b, leadToken, userWantsHouse) - scoreRow(a, leadToken, userWantsHouse)
  );
  return merged;
}

function searchUrl(limit = 18) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("dedupe", "0");
  return url;
}

function looksLikeHouseNumberThenStreet(q) {
  return /^\d{1,6}[A-Za-z\-/]?\s+\p{L}/u.test(q);
}

function queryTooShort(q) {
  if (q.length < 2) return true;
  if (q.length >= 3) return false;
  return !/^\d/.test(q);
}

function formatLabelFromComponents(components, fallbackLabel) {
  if (!components || typeof components !== "object") return fallbackLabel || "";
  const streetLine = String(components.street_line || "").trim();
  const locality = String(components.locality || "").trim();
  const admin1 = String(components.administrative_area_level_1 || "").trim();
  const postal = String(components.postal_code || "").trim();
  const country = String(components.country || "").trim();

  const parts = [];
  if (streetLine) parts.push(streetLine);
  if (locality) parts.push(locality);
  if (admin1 && admin1 !== locality) parts.push(admin1);
  if (postal) parts.push(postal);
  if (country) parts.push(country);

  const built = parts.join(", ").trim();
  if (!built) return fallbackLabel || "";

  // If fallback already contains a street number, keep it (prevents weird reformatting).
  const fb = String(fallbackLabel || "").trim();
  if (fb && /^\d/.test(fb)) return fb;
  return built;
}

function nominatimRowToSuggestion(row) {
  const addr = row.address || {};
  const components = fromNominatim(addr, row.display_name);
  return {
    label: formatLabelFromComponents(components, row.display_name),
    lat: Number(row.lat),
    lng: Number(row.lon),
    components,
    provider: "nominatim",
    needsDetails: false,
    placeId: null,
  };
}

/**
 * Localhost has no public IP for GeoIP. Use optional env coords or forward-geocode
 * Admin country/province/city so “Approximate” still returns a map point in dev.
 */
export async function localDevMapCenterPlace() {
  const elat = process.env.DEV_GEO_FALLBACK_LAT;
  const elng = process.env.DEV_GEO_FALLBACK_LNG;
  if (
    elat != null &&
    elng != null &&
    String(elat).trim() !== "" &&
    String(elng).trim() !== ""
  ) {
    const la = Number(elat);
    const ln = Number(elng);
    if (Number.isFinite(la) && Number.isFinite(ln)) {
      const p = await reverseGeocode(la, ln);
      return { ...p, approximate: true, dev_fallback: "env" };
    }
  }

  const row = db
    .prepare("SELECT country, province, city FROM app_settings WHERE id=1")
    .get();
  const city = String(row?.city || "").trim();
  const province = String(row?.province || "").trim();
  const country = String(row?.country || "").trim();
  const q = [city, province, country].filter(Boolean).join(", ");
  if (!q) return null;

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("q", q);
  if (country.length === 2) {
    url.searchParams.set("countrycodes", country.toLowerCase());
  }

  const rows = await nominatimFetch(url);
  const first = rows[0];
  if (!first) return null;
  return {
    ...nominatimRowToSuggestion(first),
    approximate: true,
    dev_fallback: "admin_settings",
  };
}

export async function suggestNominatim(query, queryParams) {
  const q = String(query || "").trim();
  if (queryTooShort(q)) return [];

  const country = String(queryParams.country || "").trim().toLowerCase();
  const row = db
    .prepare("SELECT country, province, city FROM app_settings WHERE id=1")
    .get();
  const dbCountry = row?.country || "";
  const province = String(queryParams.province || row?.province || "").trim();
  const city = String(queryParams.city || row?.city || "").trim();
  const cc = (country || dbCountry).toLowerCase();

  const contextParts = [city, province].filter(Boolean);
  const contextStr = contextParts.join(", ");
  const houseFirst = looksLikeHouseNumberThenStreet(q);
  const hasDigit = /\d/.test(q);

  // House-number queries are where users feel "street number missing".
  // Keep Nominatim calls minimal (fast + policy friendly) and focused on addresses.
  if (houseFirst) {
    const requests = [];

    const addrQ = contextStr ? `${q}, ${contextStr}` : q;
    const u = searchUrl(28);
    u.searchParams.set("q", addrQ);
    if (cc) u.searchParams.set("countrycodes", cc);
    u.searchParams.set("layer", "address");
    requests.push(() => nominatimFetch(u));

    // Structured form can return housenumber matches when free-form doesn't.
    if (contextStr) {
      const stUrl = searchUrl(28);
      stUrl.searchParams.set("street", q);
      if (city) stUrl.searchParams.set("city", city);
      if (province) stUrl.searchParams.set("state", province);
      if (cc) stUrl.searchParams.set("countrycodes", cc);
      stUrl.searchParams.set("layer", "address");
      requests.push(() => nominatimFetch(stUrl));
    }

    let combined = [];
    for (const run of requests) combined.push(...(await run()));
    const ranked = mergeAndRank(combined, q);

    // Prefer actual house-number hits if any exist.
    const withHouse = ranked.filter((r) => Boolean(r.address?.house_number));
    const finalRows = withHouse.length ? withHouse : ranked;
    return finalRows.slice(0, 8).map(nominatimRowToSuggestion);
  }

  let primaryFreeQ = q;
  let altFreeQ = null;
  if (contextStr && hasDigit) {
    primaryFreeQ = `${q}, ${contextStr}`;
    altFreeQ = `${contextStr}, ${q}`;
  } else if (contextStr) {
    primaryFreeQ = `${q}, ${contextStr}`;
  }

  const hasLocationHint = Boolean(city || province || cc);
  const useStructured = hasLocationHint && hasDigit;

  const requests = [];

  const pushFree = (queryStr) => {
    const u = searchUrl();
    u.searchParams.set("q", queryStr);
    if (cc) u.searchParams.set("countrycodes", cc);
    requests.push(() => nominatimFetch(u));
  };

  pushFree(primaryFreeQ);
  if (altFreeQ && altFreeQ !== primaryFreeQ) pushFree(altFreeQ);

  if (hasDigit && contextStr) {
    const addrLay = searchUrl();
    addrLay.searchParams.set("q", `${contextStr}, ${q}`);
    if (cc) addrLay.searchParams.set("countrycodes", cc);
    addrLay.searchParams.set("layer", "address");
    requests.push(() => nominatimFetch(addrLay));
  }

  if (useStructured) {
    const stUrl = searchUrl();
    stUrl.searchParams.set("street", q);
    if (city) stUrl.searchParams.set("city", city);
    if (province) stUrl.searchParams.set("state", province);
    if (cc) stUrl.searchParams.set("countrycodes", cc);
    requests.push(() => nominatimFetch(stUrl));
  }

  let combined = [];
  for (const run of requests) {
    combined.push(...(await run()));
  }

  if (!combined.length && hasDigit) {
    const bare = searchUrl();
    bare.searchParams.set("q", q);
    if (cc) bare.searchParams.set("countrycodes", cc);
    combined = await nominatimFetch(bare);
  }

  const ranked = mergeAndRank(combined, q);
  return ranked.slice(0, 8).map(nominatimRowToSuggestion);
}

async function googleAutocompleteRequest(q, bias) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return [];

  const body = {
    input: q,
    languageCode: "en",
  };

  const cc = bias.countryCode?.toUpperCase();
  if (cc && cc.length === 2) {
    body.includedRegionCodes = [cc];
  }

  if (bias.lat != null && bias.lng != null && bias.radiusMeters) {
    body.locationBias = {
      circle: {
        center: { latitude: bias.lat, longitude: bias.lng },
        radius: bias.radiusMeters,
      },
    };
  }

  const r = await fetch(
    "https://places.googleapis.com/v1/places:autocomplete",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "suggestions.placePrediction.place,suggestions.placePrediction.placeId,suggestions.placePrediction.text",
      },
      body: JSON.stringify(body),
    }
  );

  if (!r.ok) return [];
  const json = await r.json();
  const suggestions = json.suggestions || [];
  const out = [];
  for (const s of suggestions) {
    const pp = s.placePrediction;
    if (!pp) continue;
    const label = pp.text?.text || "";
    if (!label) continue;
    const resource = pp.place || (pp.placeId ? `places/${pp.placeId}` : "");
    out.push({
      label,
      lat: null,
      lng: null,
      components: emptyComponents(),
      provider: "google",
      needsDetails: true,
      placeId: pp.placeId || null,
      googlePlaceResource: resource || null,
    });
  }
  return out.slice(0, 8);
}

export async function suggestGoogle(query, bias) {
  const q = String(query || "").trim();
  if (q.length < 2 || (q.length < 3 && !/^\d/.test(q))) return [];
  return googleAutocompleteRequest(q, bias);
}

export async function googlePlaceDetails(placeResourceOrId) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error("google_not_configured");
  }

  let name = String(placeResourceOrId || "").trim();
  if (!name.startsWith("places/")) {
    name = `places/${name}`;
  }

  const url = `https://places.googleapis.com/v1/${encodeURIComponent(name)}`;

  const r = await fetch(url, {
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "id,formattedAddress,addressComponents,location,displayName",
    },
  });

  if (!r.ok) {
    const t = await r.text();
    throw new Error(`google_place_failed:${r.status}:${t.slice(0, 120)}`);
  }

  const place = await r.json();
  const lat = place.location?.latitude;
  const lng = place.location?.longitude;
  const formatted = place.formattedAddress || place.displayName?.text || "";

  const components = fromGoogleComponents(
    place.addressComponents || [],
    formatted
  );

  return {
    label: formatLabelFromComponents(components, formatted),
    lat: Number(lat),
    lng: Number(lng),
    components,
    provider: "google",
    needsDetails: false,
    placeId: place.id || name,
  };
}

/** Reverse geocode — Google when configured (finer addresses in many regions), else Nominatim with building-level zoom. */
export async function reverseGeocode(lat, lng) {
  const rev = getReverseProvider();
  if (rev === "google") {
    try {
      const g = await googleReverseGeocode(lat, lng);
      if (g) return g;
    } catch {
      // fall through to Nominatim
    }
  }

  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("zoom", "18");

  const row = await nominatimFetchJson(url);
  if (!row || row.error) {
    return {
      label: `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`,
      lat: Number(lat),
      lng: Number(lng),
      components: emptyComponents(),
      provider: "nominatim",
      needsDetails: false,
      placeId: null,
    };
  }

  const addr = row.address || {};
  const components = fromNominatim(addr, row.display_name);
  return {
    label: formatLabelFromComponents(components, row.display_name),
    lat: Number(row.lat ?? lat),
    lng: Number(row.lon ?? lng),
    components,
    provider: "nominatim",
    needsDetails: false,
    placeId: null,
  };
}

export async function geocodeSuggestUnified(q, reqQuery) {
  const cfg = getGeocodeConfig();
  const row = db.prepare("SELECT country, city FROM app_settings WHERE id=1").get();
  const dbCountry = row?.country || "";
  const city = String(reqQuery.city || row?.city || "").trim();

  const bias = {
    countryCode: String(reqQuery.country || dbCountry || "").toLowerCase(),
    radiusMeters: Number(process.env.GOOGLE_LOCATION_BIAS_RADIUS_M || 50000),
    lat: null,
    lng: null,
  };

  const lat = Number(reqQuery.bias_lat);
  const lng = Number(reqQuery.bias_lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    bias.lat = lat;
    bias.lng = lng;
  } else if (city && dbCountry) {
    // Light bias: approximate via forward search would add requests; skip or use env center
    const glat = process.env.APP_CENTER_LAT;
    const glng = process.env.APP_CENTER_LNG;
    if (glat && glng) {
      bias.lat = Number(glat);
      bias.lng = Number(glng);
    }
  }

  if (cfg.provider === "google") {
    try {
      const g = await suggestGoogle(q, bias);
      if (g.length) return g;
    } catch {
      // fall through to nominatim
    }
  }

  return suggestNominatim(q, reqQuery);
}
