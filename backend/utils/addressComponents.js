/**
 * Normalized address shape for pickup/dropoff (provider-agnostic).
 * Mirrors common Google address_component types where possible.
 */

export function emptyComponents() {
  return {
    formatted_address: "",
    street_number: "",
    route: "",
    street_line: "",
    locality: "",
    administrative_area_level_1: "",
    postal_code: "",
    country: "",
    country_code: "",
    neighborhood: "",
    premise: "",
  };
}

/** Nominatim jsonv2 `address` object → normalized fields */
export function fromNominatim(addr, displayName) {
  const out = emptyComponents();
  if (!addr || typeof addr !== "object") {
    out.formatted_address = displayName || "";
    return out;
  }
  const road =
    addr.road ||
    addr.pedestrian ||
    addr.path ||
    addr.footway ||
    addr.residential ||
    "";
  let hn = String(addr.house_number || "").trim();
  if (!hn) {
    const m = String(displayName || "").trim().match(/^(\d[\dA-Za-z-]{0,9})\b/);
    if (m) hn = m[1];
  }
  const streetLine = [hn, road].filter(Boolean).join(" ").trim();
  const locality =
    addr.city ||
    addr.town ||
    addr.village ||
    addr.hamlet ||
    addr.municipality ||
    addr.suburb ||
    "";
  const state =
    addr.state ||
    addr.region ||
    addr.state_district ||
    "";
  out.formatted_address = displayName || "";
  out.street_number = hn;
  out.route = road;
  out.street_line = streetLine || out.formatted_address;
  out.locality = locality;
  out.administrative_area_level_1 = state;
  out.postal_code = String(addr.postcode || "").trim();
  out.country = String(addr.country || "").trim();
  out.country_code = String(addr.country_code || "").trim().toLowerCase();
  out.neighborhood =
    String(addr.neighbourhood || addr.quarter || addr.suburb || "").trim() ||
    "";
  out.premise = String(addr.building || addr.amenity || "").trim() || "";
  return out;
}

/** Google Places API (New) addressComponents array */
export function fromGoogleComponents(components, formattedAddress) {
  const out = emptyComponents();
  out.formatted_address = formattedAddress || "";

  if (!Array.isArray(components)) return out;

  const byType = (t) => {
    const c = components.find((x) => x.types?.includes(t));
    if (!c) return "";
    return String(c.longText || c.shortText || "").trim();
  };

  out.street_number = byType("street_number");
  out.route = byType("route");
  out.locality =
    byType("locality") ||
    byType("postal_town") ||
    byType("sublocality") ||
    byType("neighborhood");
  out.administrative_area_level_1 = byType("administrative_area_level_1");
  out.postal_code = byType("postal_code");
  out.country = byType("country");
  out.country_code = String(
    components.find((x) => x.types?.includes("country"))?.shortText || ""
  )
    .trim()
    .toLowerCase();
  out.neighborhood =
    byType("neighborhood") || byType("sublocality_level_1") || "";
  out.premise =
    byType("premise") || byType("subpremise") || byType("point_of_interest");

  // Some results omit street_number in components even when formatted text includes it.
  // Best-effort infer from the formatted address (keeps blank if not confidently present).
  if (!out.street_number) {
    const m = String(formattedAddress || "").trim().match(/^(\d[\dA-Za-z-]{0,9})\s+/);
    if (m) out.street_number = m[1];
  }

  out.street_line = [out.street_number, out.route].filter(Boolean).join(" ");
  return out;
}
