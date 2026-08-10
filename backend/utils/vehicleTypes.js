// ============================================================
// VEHICLE TYPE UTILITY - FINAL
// Supports Car, MPV, Bike (ride create + DB CHECK)
// ============================================================

/**
 * Frontend/API types → database types
 */
export const VEHICLE_TYPE_MAP = {
  standard: "Car",
  premium: "Car",
  xl: "MPV",
  bike: "Bike",
  Car: "Car",
  MPV: "MPV",
  Bike: "Bike",
  // Legacy DB labels still seen in old rows / profiles
  Auto: "Car",
  Mini: "Car",
  Sedan: "Car",
};

/** Match ride-create canonical DB values */
export const VALID_DB_TYPES = ["Car", "MPV", "Bike"];

/** Accepted API / Flutter ride-request inputs */
export const VALID_RIDE_TYPES = [
  "standard",
  "premium",
  "xl",
  "bike",
  "Car",
  "MPV",
  "Bike",
];

/**
 * Map for ride creation — Car | MPV | Bike (default Car).
 */
export function mapVehicleTypeForRide(type) {
  if (type == null || type === "") return "Car";
  const mapped = VEHICLE_TYPE_MAP[String(type).trim()];
  if (!mapped) return "Car";
  if (mapped === "Bike") return "Bike";
  if (mapped === "MPV") return "MPV";
  return "Car";
}

/** General map (preserves Bike). */
export function mapVehicleType(type) {
  if (type == null || type === "") return "Car";
  return VEHICLE_TYPE_MAP[String(type).trim()] || "Car";
}

export function isValidDBType(type) {
  return VALID_DB_TYPES.includes(type);
}

export function isValidRideType(type) {
  return VALID_RIDE_TYPES.includes(String(type ?? "").trim());
}

/** Normalize input for ride create; undefined → Car. */
export function normalizeVehicleType(input) {
  if (!input) return "Car";
  return mapVehicleTypeForRide(input);
}

// Back-compat helpers
export function getValidVehicleTypes() {
  return [...VALID_DB_TYPES];
}

export function getRideVehicleTypes() {
  return [...VALID_DB_TYPES];
}

export function getVehicleTypeAliases() {
  return Object.keys(VEHICLE_TYPE_MAP);
}

export function isValidVehicleType(type) {
  return isValidRideType(type) || Object.hasOwn(VEHICLE_TYPE_MAP, String(type ?? "").trim());
}

export function isValidRideVehicleType(type) {
  return VALID_DB_TYPES.includes(mapVehicleTypeForRide(type));
}

export default {
  VEHICLE_TYPE_MAP,
  VALID_DB_TYPES,
  VALID_RIDE_TYPES,
  mapVehicleTypeForRide,
  mapVehicleType,
  isValidDBType,
  isValidRideType,
  normalizeVehicleType,
};
