/** Great-circle distance in meters (Haversine). */
export function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const aLat = toRad(lat1);
  const bLat = toRad(lat2);

  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat) * Math.cos(bLat) * Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Alias matching common API naming (meters by default). */
export function haversineDistance(lat1, lon1, lat2, lon2, unit = "m") {
  const meters = haversineMeters(lat1, lon1, lat2, lon2);
  return unit === "km" ? meters / 1000 : meters;
}

export function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

export function toDegrees(radians) {
  return (radians * 180) / Math.PI;
}

/**
 * Rough bounding box for SQL pre-filter (not a true geodesic circle).
 * @returns {{ minLat: number, maxLat: number, minLon: number, maxLon: number }}
 */
export function getBoundingBox(lat, lon, radiusMeters) {
  const latDelta = radiusMeters / 111_000;
  const lonDelta =
    radiusMeters / (111_000 * Math.max(Math.cos(toRadians(lat)), 0.01));
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLon: lon - lonDelta,
    maxLon: lon + lonDelta,
  };
}

export function isValidCoordinates(lat, lon) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

export function formatCoordinates(lat, lon) {
  return {
    lat: parseFloat(Number(lat).toFixed(7)),
    lng: parseFloat(Number(lon).toFixed(7)),
  };
}
