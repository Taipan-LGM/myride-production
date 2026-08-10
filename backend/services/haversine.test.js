import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getBoundingBox,
  haversineMeters,
} from "../lib/geo.js";

test("haversineMeters: same point is zero", () => {
  assert.equal(haversineMeters(-33.96, 25.6, -33.96, 25.6), 0);
});

test("haversineMeters: known distance order of magnitude", () => {
  // ~111 km per degree latitude at equator; 0.01° ≈ 1.11 km
  const d = haversineMeters(0, 0, 0.01, 0);
  assert.ok(d > 1000 && d < 1200, `expected ~1110m, got ${d}`);
});

test("haversineMeters: symmetric", () => {
  const a = haversineMeters(-33.9249, 18.4241, -33.96, 25.6);
  const b = haversineMeters(-33.96, 25.6, -33.9249, 18.4241);
  assert.equal(a, b);
});
