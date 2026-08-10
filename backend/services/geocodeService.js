import { db } from "../database.js";
import {
  emptyComponents,
  fromNominatim,
  fromGoogleComponents,
} from "../utils/addressComponents.js";

const USER_AGENT = "MyRide/1.0.3 (contact: see README; demo geocoder)";

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

const DEFAULT_GOOGLE_AUTOCOMPLETE_PRIMARY_TYPES = [
  "premise",
  "street_address",
  "subpremise",
];

/**
 * `GOOGLE_AUTOCOMPLETE_PRIMARY_TYPES` — comma-separated Place primary types (max 5, API limit).
 * Stricter: `street_address` | Looser: add types from Google Place types (e.g. `premise,street_address,subpremise`).
 */
export function getGoogleAutocompletePrimaryTypes() {
  const raw = process.env.GOOGLE_AUTOCOMPLETE_PRIMARY_TYPES;
  if (raw == null || String(raw).trim() === "") {
    return [...DEFAULT_GOOGLE_AUTOCOMPLETE_PRIMARY_TYPES];
  }
  const parts = String(raw)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[a-z0-9_]+$/.test(s) && s.length >= 2 && s.length <= 48);
  const uniq = [...new Set(parts)];
  return uniq.length
    ? uniq.slice(0, 5)
    : [...DEFAULT_GOOGLE_AUTOCOMPLETE_PRIMARY_TYPES];
}

/**
 * `GOOGLE_AUTOCOMPLETE_REGION_RESTRICTION` default `admin_country`: set `includedRegionCodes` to the
 * 2-letter country from the request or Admin settings. Set to `none` to omit (global, looser).
 */
export function googleAutocompleteUsesRegionRestriction() {
  const x = String(
    process.env.GOOGLE_AUTOCOMPLETE_REGION_RESTRICTION ?? "admin_country"
  )
    .toLowerCase()
    .trim();
  if (x === "none" || x === "off" || x === "false" || x === "0") return false;
  return true;
}

/**
 * When Admin enables “ZA only”, all address autocomplete bias uses South Africa (`za`),
 * ignoring per-request country (customers cannot search other countries).
 */
export function getEffectiveGeocodeCountryCode(queryParams = {}) {
  const row = db
    .prepare("SELECT country, geocode_za_only FROM app_settings WHERE id=1")
    .get();
  if (Number(row?.geocode_za_only) === 1) return "za";
  const fromReq = String(queryParams.country ?? "").trim().toLowerCase();
  const dbCountry = String(row?.country ?? "").trim().toLowerCase();
  return (fromReq || dbCountry || "").slice(0, 2);
}

/** Admin Settings → “South Africa (ZA) only” for address search. */
export function isGeocodeZaOnlyEnabled() {
  const row = db
    .prepare("SELECT geocode_za_only FROM app_settings WHERE id=1")
    .get();
  return Number(row?.geocode_za_only) === 1;
}

/** True if normalized place components resolve to South Africa (ISO ZA). */
export function placeIsInSouthAfrica(place) {
  const c = place?.components;
  if (!c || typeof c !== "object") return false;
  const cc = String(c.country_code || "").trim().toLowerCase();
  if (cc === "za") return true;
  const name = String(c.country || "").trim().toLowerCase();
  return name === "south africa";
}

/**
 * When true, every autocomplete request merges Nominatim with Google (never short-circuit on count).
 * Env: GEOCODE_GOOGLE_SUGGEST_ALWAYS_MERGE_OSM=1|true|yes|on
 */
export function googleSuggestAlwaysMergeOsm() {
  const v = String(process.env.GEOCODE_GOOGLE_SUGGEST_ALWAYS_MERGE_OSM ?? "")
    .trim()
    .toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
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
    googleAutocompletePrimaryTypes: getGoogleAutocompletePrimaryTypes(),
    googleAutocompleteRegionRestriction: googleAutocompleteUsesRegionRestriction()
      ? "admin_country"
      : "none",
    geocodeZaOnly: isGeocodeZaOnlyEnabled(),
    googleSuggestAlwaysMergeOsm: googleSuggestAlwaysMergeOsm(),
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

/** Legacy Geocoding API `address_components` entry uses long_name / types[]. */
function legacyGeocodeComponentsHaveStreetNumber(addressComponents) {
  if (!Array.isArray(addressComponents)) return false;
  return addressComponents.some(
    (c) =>
      Array.isArray(c.types) &&
      c.types.includes("street_number") &&
      String(c.long_name || c.short_name || "").trim() !== ""
  );
}

/** First reverse-geocode hit whose raw components include `street_number`. */
async function googleReverseGeocodeFirstVerifiedStreet(lat, lng) {
  const key = process.env.GOOGLE_PLACES_API_KEY || "";
  if (!key) return null;
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("latlng", `${Number(lat)},${Number(lng)}`);
  url.searchParams.set("key", key);
  const r = await fetch(url);
  if (!r.ok) return null;
  const j = await r.json();
  if (j.status !== "OK" || !j.results?.length) return null;
  for (const res of j.results) {
    if (!legacyGeocodeComponentsHaveStreetNumber(res.address_components)) continue;
    const loc = res.geometry?.location;
    if (loc?.lat == null || loc?.lng == null) continue;
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
  return null;
}

/**
 * Closest verified postal-style address near a point (for “exact number not in Places DB” fallback).
 */
export async function nearestVerifiedAddressFromLatLng(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;

  const g = await googleReverseGeocodeFirstVerifiedStreet(la, ln);
  if (g) return g;

  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(la));
  url.searchParams.set("lon", String(ln));
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("zoom", "18");

  const row = await nominatimFetchJson(url);
  if (!row?.address?.house_number || String(row.address.house_number).trim() === "") {
    return null;
  }
  return nominatimRowToSuggestion(row);
}

/**
 * Forward geocode (Plus Codes, addresses). Optional `restrictCountry` is a 2-letter ISO code
 * passed to Google as `components=country:XX` (recommended with Admin ZA-only).
 */
export async function googleGeocodeForward(query, options = {}) {
  const key = process.env.GOOGLE_PLACES_API_KEY || "";
  if (!key) throw new Error("google_not_configured");
  const q = String(query || "").trim();
  if (!q) return null;
  const restrict = String(options.restrictCountry || "")
    .trim()
    .toLowerCase();
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", q);
  url.searchParams.set("key", key);
  if (/^[a-z]{2}$/.test(restrict)) {
    url.searchParams.set("components", `country:${restrict.toUpperCase()}`);
  }
  const r = await fetch(url);
  if (!r.ok) return null;
  const j = await r.json();
  if (j.status !== "OK" || !j.results?.length) return null;
  const res = j.results[0];
  const loc = res.geometry?.location;
  if (loc?.lat == null || loc?.lng == null) return null;
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

/**
 * Pickup/dropoff (Nominatim / resolved rows): prefer rows whose label or components show a street number.
 * Google autocomplete rows are filtered to `getGoogleAutocompletePrimaryTypes()` (see `googlePlacePredictionTypesValid`).
 */
export function suggestionHasStreetNumber(suggestion) {
  if (!suggestion || typeof suggestion !== "object") return false;
  const c = suggestion.components || {};
  const sn = String(c.street_number || "").trim();
  if (sn && /^\d/u.test(sn)) return true;
  const sl = String(c.street_line || "").trim();
  if (sl && /^\d/u.test(sl.split(/\s+/)[0] || "")) return true;

  const label = String(suggestion.label || "").trim();
  return textFirstLineLooksLikeStreetAddress(label);
}

/** First comma-separated segment looks like "123 Main St" or "Unit 5 …" / "#12 …". */
function textFirstLineLooksLikeStreetAddress(text) {
  const first = String(text || "").split(",")[0].trim();
  if (!first) return false;
  if (/^\d[\dA-Za-z\-/]{0,12}\b/u.test(first)) return true;
  return /^(?:unit|apt|apartment|suite|ste\.?|#)\s*[\dA-Za-z-]+/iu.test(first);
}

/** Prefer predictions that already show a street number (house-style matches first). */
function sortSuggestionsStreetNumbersFirst(list) {
  if (!Array.isArray(list)) return [];
  return [...list].sort((a, b) => {
    const da = Number(suggestionHasStreetNumber(a));
    const db = Number(suggestionHasStreetNumber(b));
    if (db !== da) return db - da;
    return String(a.label || "").localeCompare(String(b.label || ""), undefined, {
      sensitivity: "base",
      numeric: true,
    });
  });
}

function normSuggestionLabel(s) {
  return String(s?.label || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 96);
}

/** Google predictions first; append OSM rows that are not duplicates (label or ~same coords). */
function mergeSuggestionLists(primary, secondary, max = 20) {
  const out = [];
  const seenLabels = new Set();
  const seenCoords = new Set();

  const push = (s) => {
    if (!s || out.length >= max) return;
    const nl = normSuggestionLabel(s);
    const lat = Number(s.lat);
    const lng = Number(s.lng);
    if (nl && seenLabels.has(nl)) return;
    if (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      seenCoords.has(`${lat.toFixed(4)},${lng.toFixed(4)}`)
    ) {
      return;
    }
    if (nl) seenLabels.add(nl);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      seenCoords.add(`${lat.toFixed(4)},${lng.toFixed(4)}`);
    }
    out.push(s);
  };

  for (const s of primary || []) push(s);
  const secondarySorted = sortSuggestionsStreetNumbersFirst(secondary || []);
  for (const s of secondarySorted) push(s);
  return out;
}

/**
 * Types on each place prediction; any match to env-driven primary types is kept.
 */
function googlePlacePredictionTypesValid(pp) {
  if (!pp || typeof pp !== "object") return false;
  const types = Array.isArray(pp.types) ? pp.types : [];
  const allowed = getGoogleAutocompletePrimaryTypes();
  return allowed.some((t) => types.includes(t));
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
  merged.sort((a, b) => {
    const da = scoreRow(a, leadToken, userWantsHouse);
    const db = scoreRow(b, leadToken, userWantsHouse);
    if (db !== da) return db - da;
    return String(a.display_name || "").localeCompare(
      String(b.display_name || ""),
      undefined,
      { sensitivity: "base", numeric: true }
    );
  });
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

/** First Nominatim search request only (one HTTP round-trip) for parallel merge with Google. */
async function nominatimPrimaryFetchRows(query, queryParams) {
  const q = String(query || "").trim();
  if (queryTooShort(q)) return [];

  const row = db
    .prepare("SELECT country, province, city FROM app_settings WHERE id=1")
    .get();
  const province = String(queryParams.province || row?.province || "").trim();
  const city = String(queryParams.city || row?.city || "").trim();
  const cc = getEffectiveGeocodeCountryCode(queryParams);

  const contextParts = [city, province].filter(Boolean);
  const contextStr = contextParts.join(", ");
  const houseFirst = looksLikeHouseNumberThenStreet(q);
  const hasDigit = /\d/.test(q);

  if (houseFirst) {
    const addrQ = contextStr ? `${q}, ${contextStr}` : q;
    const u = searchUrl(22);
    u.searchParams.set("q", addrQ);
    if (cc) u.searchParams.set("countrycodes", cc);
    u.searchParams.set("layer", "address");
    return nominatimFetch(u);
  }

  let primaryFreeQ = q;
  if (contextStr && hasDigit) {
    primaryFreeQ = `${q}, ${contextStr}`;
  } else if (contextStr) {
    primaryFreeQ = `${q}, ${contextStr}`;
  }

  const u0 = searchUrl(18);
  u0.searchParams.set("q", primaryFreeQ);
  if (cc) u0.searchParams.set("countrycodes", cc);
  return nominatimFetch(u0);
}

/** Single-shot OSM suggestions for fast merge (no follow-up Nominatim requests). */
async function suggestNominatimParallel(query, queryParams) {
  const q = String(query || "").trim();
  if (queryTooShort(q)) return [];
  const rows = await nominatimPrimaryFetchRows(q, queryParams);
  const houseFirst = looksLikeHouseNumberThenStreet(q);
  const ranked = mergeAndRank(rows, q);
  let finalRows = ranked;
  if (houseFirst) {
    const withHouse = ranked.filter((r) => Boolean(r.address?.house_number));
    finalRows = withHouse.length ? withHouse : ranked;
  }
  return sortSuggestionsStreetNumbersFirst(
    finalRows.slice(0, 15).map(nominatimRowToSuggestion)
  );
}

export async function suggestNominatim(query, queryParams) {
  const q = String(query || "").trim();
  if (queryTooShort(q)) return [];

  const row = db
    .prepare("SELECT country, province, city FROM app_settings WHERE id=1")
    .get();
  const province = String(queryParams.province || row?.province || "").trim();
  const city = String(queryParams.city || row?.city || "").trim();
  const cc = getEffectiveGeocodeCountryCode(queryParams);

  const contextParts = [city, province].filter(Boolean);
  const contextStr = contextParts.join(", ");
  const houseFirst = looksLikeHouseNumberThenStreet(q);
  const hasDigit = /\d/.test(q);

  // House-number queries are where users feel "street number missing".
  // Keep Nominatim calls minimal (fast + policy friendly) and focused on addresses.
  if (houseFirst) {
    let combined = [...(await nominatimPrimaryFetchRows(q, queryParams))];

    if (combined.length < 8 && contextStr) {
      const stUrl = searchUrl(22);
      stUrl.searchParams.set("street", q);
      if (city) stUrl.searchParams.set("city", city);
      if (province) stUrl.searchParams.set("state", province);
      if (cc) stUrl.searchParams.set("countrycodes", cc);
      stUrl.searchParams.set("layer", "address");
      combined.push(...(await nominatimFetch(stUrl)));
    }

    const ranked = mergeAndRank(combined, q);

    // Prefer actual house-number hits if any exist.
    const withHouse = ranked.filter((r) => Boolean(r.address?.house_number));
    const finalRows = withHouse.length ? withHouse : ranked;
    return sortSuggestionsStreetNumbersFirst(
      finalRows.slice(0, 15).map(nominatimRowToSuggestion)
    );
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

  let combined = [...(await nominatimPrimaryFetchRows(q, queryParams))];

  if (combined.length < 10 && altFreeQ && altFreeQ !== primaryFreeQ) {
    const u1 = searchUrl(18);
    u1.searchParams.set("q", altFreeQ);
    if (cc) u1.searchParams.set("countrycodes", cc);
    combined.push(...(await nominatimFetch(u1)));
  }

  if (combined.length < 8 && useStructured) {
    const stUrl = searchUrl(18);
    stUrl.searchParams.set("street", q);
    if (city) stUrl.searchParams.set("city", city);
    if (province) stUrl.searchParams.set("state", province);
    if (cc) stUrl.searchParams.set("countrycodes", cc);
    combined.push(...(await nominatimFetch(stUrl)));
  }

  if (combined.length < 8 && hasDigit && contextStr) {
    const addrLay = searchUrl(18);
    addrLay.searchParams.set("q", `${contextStr}, ${q}`);
    if (cc) addrLay.searchParams.set("countrycodes", cc);
    addrLay.searchParams.set("layer", "address");
    combined.push(...(await nominatimFetch(addrLay)));
  }

  if (!combined.length && hasDigit) {
    const bare = searchUrl(18);
    bare.searchParams.set("q", q);
    if (cc) bare.searchParams.set("countrycodes", cc);
    combined = await nominatimFetch(bare);
  }

  const ranked = mergeAndRank(combined, q);
  return sortSuggestionsStreetNumbersFirst(
    ranked.slice(0, 15).map(nominatimRowToSuggestion)
  );
}

async function googleAutocompleteRequest(q, bias) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return [];

  const body = {
    input: q,
    languageCode: "en",
    includedPrimaryTypes: getGoogleAutocompletePrimaryTypes(),
  };

  const cc = bias.countryCode?.toUpperCase();
  if (
    googleAutocompleteUsesRegionRestriction() &&
    cc &&
    cc.length === 2
  ) {
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
          "suggestions.placePrediction.place,suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.types",
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
    if (!googlePlacePredictionTypesValid(pp)) continue;
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
  return out.slice(0, 15);
}

export async function suggestGoogle(query, bias) {
  const q = String(query || "").trim();
  if (q.length < 2 || (q.length < 3 && !/^\d/.test(q))) return [];
  return googleAutocompleteRequest(q, bias);
}

/** Persist analytics row when Place Details lacks a verified street_number. */
export function recordFailedAddressAttempt({
  user_input = "",
  google_prediction = "",
  missing_reason = "street_number",
  timestamp = Date.now(),
}) {
  try {
    db.prepare(
      `INSERT INTO failed_address_attempts (user_input, google_prediction, missing_reason, timestamp)
       VALUES (?,?,?,?)`
    ).run(
      String(user_input).slice(0, 1024),
      String(google_prediction).slice(0, 1024),
      String(missing_reason).slice(0, 64),
      Number(timestamp) || Date.now()
    );
  } catch {
    /* never block geocode */
  }
}

export function googleAddressHasVerifiedStreetNumberComponent(addressComponents) {
  if (!Array.isArray(addressComponents)) return false;
  return addressComponents.some(
    (c) =>
      Array.isArray(c.types) &&
      c.types.includes("street_number") &&
      String(c.longText || c.shortText || "").trim() !== ""
  );
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

  if (!googleAddressHasVerifiedStreetNumberComponent(place.addressComponents)) {
    let nearestVerified = null;
    const la = Number(lat);
    const ln = Number(lng);
    if (Number.isFinite(la) && Number.isFinite(ln)) {
      nearestVerified = await nearestVerifiedAddressFromLatLng(la, ln);
    }
    const err = new Error("google_place_no_street_number");
    err.nearestVerified = nearestVerified;
    err.google_prediction =
      String(formatted || place.displayName?.text || "").trim();
    throw err;
  }

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
  const city = String(reqQuery.city || row?.city || "").trim();

  const bias = {
    countryCode: getEffectiveGeocodeCountryCode(reqQuery),
    radiusMeters: Number(process.env.GOOGLE_LOCATION_BIAS_RADIUS_M || 50000),
    lat: null,
    lng: null,
  };

  const lat = Number(reqQuery.bias_lat);
  const lng = Number(reqQuery.bias_lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    bias.lat = lat;
    bias.lng = lng;
  } else if (city && row?.country) {
    // Light bias: approximate via forward search would add requests; skip or use env center
    const glat = process.env.APP_CENTER_LAT;
    const glng = process.env.APP_CENTER_LNG;
    if (glat && glng) {
      bias.lat = Number(glat);
      bias.lng = Number(glng);
    }
  }

  if (cfg.provider === "google") {
    const skipOsThreshold = Number(
      process.env.GEOCODE_GOOGLE_SUGGEST_SKIP_OS_THRESHOLD ?? 4
    );

    if (googleSuggestAlwaysMergeOsm()) {
      const [g, nFast] = await Promise.all([
        suggestGoogle(q, bias).catch(() => []),
        suggestNominatimParallel(q, reqQuery).catch(() => []),
      ]);
      const merged = mergeSuggestionLists(g, nFast, 20);
      if (merged.length) return merged;
      const nFull = await suggestNominatim(q, reqQuery).catch(() => []);
      const merged2 = mergeSuggestionLists(g, nFull, 20);
      if (merged2.length) return merged2;
    } else {
      const g = await suggestGoogle(q, bias).catch(() => []);
      if (
        Number.isFinite(skipOsThreshold) &&
        skipOsThreshold > 0 &&
        g.length >= skipOsThreshold
      ) {
        return g;
      }
      const nFast = await suggestNominatimParallel(q, reqQuery).catch(() => []);
      const merged = mergeSuggestionLists(g, nFast, 20);
      if (merged.length) return merged;
      const nFull = await suggestNominatim(q, reqQuery).catch(() => []);
      const merged2 = mergeSuggestionLists(g, nFull, 20);
      if (merged2.length) return merged2;
    }
  }

  return suggestNominatim(q, reqQuery);
}
