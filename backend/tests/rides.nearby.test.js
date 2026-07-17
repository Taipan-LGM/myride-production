import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getBoundingBox,
  haversineDistance,
  haversineMeters,
  isValidCoordinates,
} from "../lib/geo.js";
import cache, { isNearbyCacheEnabled, nearbyCacheKey } from "../lib/cache.js";

test("haversineMeters: same point is zero", () => {
  assert.equal(haversineMeters(-33.96, 25.6, -33.96, 25.6), 0);
});

test("haversineDistance alias returns meters", () => {
  const d = haversineDistance(0, 0, 0.01, 0, "m");
  assert.ok(d > 1000 && d < 1200);
});

test("getBoundingBox contains center", () => {
  const box = getBoundingBox(-33.96, 25.6, 5000);
  assert.ok(box.minLat < -33.96 && box.maxLat > -33.96);
  assert.ok(box.minLon < 25.6 && box.maxLon > 25.6);
});

test("isValidCoordinates rejects out of range", () => {
  assert.equal(isValidCoordinates(91, 0), false);
  assert.equal(isValidCoordinates(-33.96, 25.6), true);
});

test("nearbyCacheKey is stable for rounded coords", () => {
  const a = nearbyCacheKey({
    lat: -33.92491,
    lng: 25.57012,
    radiusM: 5000,
    vehicleType: "Car",
    limit: 20,
  });
  const b = nearbyCacheKey({
    lat: -33.92494,
    lng: 25.57014,
    radiusM: 5000,
    vehicleType: "Car",
    limit: 20,
  });
  assert.equal(a, b);
});

test("memory cache set/get and TTL expiry", async () => {
  cache.clear();
  cache.set("test-key", { ok: true }, 50);
  assert.deepEqual(cache.get("test-key"), { ok: true });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(cache.get("test-key"), null);
});

test("isNearbyCacheEnabled defaults true", () => {
  const prev = process.env.ENABLE_NEARBY_CACHE;
  delete process.env.ENABLE_NEARBY_CACHE;
  assert.equal(isNearbyCacheEnabled(), true);
  if (prev !== undefined) process.env.ENABLE_NEARBY_CACHE = prev;
});
