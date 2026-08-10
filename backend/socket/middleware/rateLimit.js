import { TIMING } from "../utils/constants.js";

/**
 * Per-socket event rate limits (in-memory).
 * @param {number} maxPerWindow
 * @param {number} windowMs
 */
export function createSocketRateLimiter(maxPerWindow = 30, windowMs = 60_000) {
  const buckets = new Map();

  return function rateLimit(socket, eventName) {
    const key = `${socket.data?.user?.id || socket.id}:${eventName}`;
    const now = Date.now();
    let bucket = buckets.get(key);

    if (!bucket || now - bucket.start > windowMs) {
      bucket = { start: now, count: 0 };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    if (bucket.count > maxPerWindow) {
      return false;
    }
    return true;
  };
}

/** Throttle high-frequency GPS (per driver user id). */
export function createLocationThrottle(minIntervalMs = TIMING.LOCATION_MIN_INTERVAL_MS) {
  const last = new Map();

  return function shouldAllow(driverUserId) {
    const now = Date.now();
    const prev = last.get(driverUserId) || 0;
    if (now - prev < minIntervalMs) return false;
    last.set(driverUserId, now);
    return true;
  };
}
