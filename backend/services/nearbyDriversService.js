import { db } from "../database.js";
import { getBoundingBox, haversineMeters, isValidCoordinates } from "../lib/geo.js";
import { isRtreeEnabled, rtreeCandidateUserIds } from "../database/rtree.js";
import { mapVehicleType } from "../utils/vehicleTypes.js";

const ACTIVE_RIDE_STATUSES = [
  "matched",
  "accepted",
  "arriving",
  "in_progress",
];

const DEFAULT_RADIUS_M = 5000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_RADIUS_M = Number(process.env.MAX_RADIUS_METERS) || 20_000;
const LOCATION_FRESH_SECONDS = 30;

function isNearbyEnabled() {
  const flag = process.env.ENABLE_NEARBY_DRIVERS;
  if (flag === "0" || flag === "false") return false;
  return true;
}

/** Drivers with an active ride assignment (not available for new requests). */
function busyDriverUserIds() {
  const placeholders = ACTIVE_RIDE_STATUSES.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `
      SELECT DISTINCT driver_id AS user_id
      FROM rides
      WHERE driver_id IS NOT NULL
        AND status IN (${placeholders})
    `
    )
    .all(...ACTIVE_RIDE_STATUSES);
  return new Set(rows.map((r) => r.user_id));
}

/**
 * @param {object} opts
 * @param {number} opts.lat
 * @param {number} opts.lng
 * @param {number} [opts.radiusM]
 * @param {string} [opts.vehicleType] Car | MPV
 * @param {number} [opts.limit]
 */
export function findNearbyDrivers({
  lat,
  lng,
  radiusM = DEFAULT_RADIUS_M,
  vehicleType,
  limit = DEFAULT_LIMIT,
}) {
  const queryRadius = Math.min(Math.max(radiusM, 100), MAX_RADIUS_M);
  const queryLimit = Math.min(limit, MAX_LIMIT);

  if (!isNearbyEnabled()) {
    return {
      drivers: [],
      total: 0,
      query_radius: queryRadius,
      query_limit: queryLimit,
    };
  }

  if (!isValidCoordinates(lat, lng)) {
    const err = new Error("invalid_coordinates");
    err.status = 400;
    throw err;
  }

  const bbox = getBoundingBox(lat, lng, queryRadius);
  const busy = busyDriverUserIds();
  const rtreeIds = rtreeCandidateUserIds(lat, lng, queryRadius);

  let sql = `
    SELECT
      u.id AS user_id,
      u.name,
      dp.license_plate,
      dp.vehicle_type,
      dp.lat,
      dp.lng,
      dp.updated_at
    FROM driver_profiles dp
    JOIN users u ON u.id = dp.user_id
    WHERE u.role = 'driver'
      AND dp.approval_status = 'approved'
      AND dp.online = 1
      AND dp.lat IS NOT NULL
      AND dp.lng IS NOT NULL
      AND dp.lat BETWEEN ? AND ?
      AND dp.lng BETWEEN ? AND ?
      AND dp.updated_at >= datetime('now', '-${LOCATION_FRESH_SECONDS} seconds')
  `;
  const params = [bbox.minLat, bbox.maxLat, bbox.minLon, bbox.maxLon];

  if (rtreeIds && rtreeIds.length > 0) {
    const placeholders = rtreeIds.map(() => "?").join(", ");
    sql += ` AND dp.user_id IN (${placeholders})`;
    params.push(...rtreeIds);
  } else if (rtreeIds && rtreeIds.length === 0 && isRtreeEnabled()) {
    return {
      drivers: [],
      total: 0,
      query_radius: queryRadius,
      query_limit: queryLimit,
    };
  }

  if (vehicleType) {
    sql += " AND dp.vehicle_type = ?";
    params.push(mapVehicleType(vehicleType));
  }

  const candidates = db.prepare(sql).all(...params);

  const withDistance = [];
  for (const row of candidates) {
    if (busy.has(row.user_id)) continue;
    const distance = haversineMeters(lat, lng, row.lat, row.lng);
    if (distance > queryRadius) continue;
    withDistance.push({ row, distance });
  }

  withDistance.sort((a, b) => a.distance - b.distance);
  const capped = withDistance.slice(0, queryLimit);

  const drivers = capped.map(({ row, distance }) => ({
    driver_id: String(row.user_id),
    user_id: String(row.user_id),
    name: row.name,
    vehicle: {
      plate_number: row.license_plate,
      vehicle_type: row.vehicle_type,
    },
    location: {
      lat: row.lat,
      lng: row.lng,
      bearing: null,
      speed: null,
      last_updated: row.updated_at,
    },
    distance: Math.round(distance),
    rating: null,
    is_available: true,
  }));

  return {
    drivers,
    total: drivers.length,
    query_radius: queryRadius,
    query_limit: queryLimit,
  };
}

/** Nearest approved online driver for a vehicle type (ride matching). */
export function pickNearestDriver({ pickup_lat, pickup_lng, vehicle_type }) {
  const { drivers } = findNearbyDrivers({
    lat: pickup_lat,
    lng: pickup_lng,
    radiusM: 50_000,
    vehicleType: vehicle_type,
    limit: 1,
  });

  if (!drivers.length) return null;

  const d = drivers[0];
  return {
    user_id: Number(d.user_id),
    name: d.name,
    vehicle_type: d.vehicle.vehicle_type,
    lat: d.location.lat,
    lng: d.location.lng,
  };
}
