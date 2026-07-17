import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createRideBodySchema,
  driverLocationBodySchema,
  nearbyDriversQuerySchema,
  paymentIntentBodySchema,
} from "../../validation/index.js";

test("createRideBodySchema maps Flutter pickup_address alias", () => {
  const parsed = createRideBodySchema.parse({
    pickup_address: "123 Main Street",
    pickup_lat: -33.92,
    pickup_lng: 25.57,
    dropoff_address: "456 Oak Avenue",
    dropoff_lat: -33.93,
    dropoff_lng: 25.58,
    vehicle_type: "standard",
  });
  assert.equal(parsed.pickup_text, "123 Main Street");
  assert.equal(parsed.vehicle_type, "Car");
});

test("nearbyDriversQuerySchema coerces query strings", () => {
  const parsed = nearbyDriversQuerySchema.parse({
    lat: "-33.92",
    lng: "25.57",
    radius: "5000",
    limit: "10",
  });
  assert.equal(parsed.lat, -33.92);
  assert.equal(parsed.limit, 10);
});

test("driverLocationBodySchema accepts nested location object", () => {
  const parsed = driverLocationBodySchema.parse({
    location: { lat: -33.92, lng: 25.57 },
  });
  assert.ok(parsed.location);
});

test("paymentIntentBodySchema requires ride_id", () => {
  assert.throws(() => paymentIntentBodySchema.parse({}));
});
