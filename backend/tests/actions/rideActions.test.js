import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RideActionError,
  fareEstimateCentsFromTripKm,
  normalizeCreateRideInput,
  splitFareCents,
} from "../../actions/rideActions.js";

test("normalizeCreateRideInput maps Flutter aliases", () => {
  const data = normalizeCreateRideInput({
    pickup_address: "123 Main St",
    pickup_lat: -33.92,
    pickup_lng: 25.57,
    dropoff_address: "456 Oak Ave",
    dropoff_lat: -33.93,
    dropoff_lng: 25.58,
    vehicle_type: "standard",
    payment_method: "cash",
  });

  assert.equal(data.pickup_text, "123 Main St");
  assert.equal(data.vehicle_type, "Car");
  assert.equal(data.payment_method, "cash");
});

test("normalizeCreateRideInput maps xl to MPV", () => {
  const data = normalizeCreateRideInput({
    pickup_address: "123 Main St",
    pickup_lat: -33.92,
    pickup_lng: 25.57,
    dropoff_address: "456 Oak Ave",
    dropoff_lat: -33.93,
    dropoff_lng: 25.58,
    vehicle_type: "xl",
  });
  assert.equal(data.vehicle_type, "MPV");
});

test("normalizeCreateRideInput maps bike to Bike", () => {
  const data = normalizeCreateRideInput({
    pickup_address: "123 Main St",
    pickup_lat: -33.92,
    pickup_lng: 25.57,
    dropoff_address: "456 Oak Ave",
    dropoff_lat: -33.93,
    dropoff_lng: 25.58,
    vehicle_type: "bike",
  });
  assert.equal(data.vehicle_type, "Bike");
});

test("normalizeCreateRideInput rejects invalid payload", () => {
  assert.throws(
    () => normalizeCreateRideInput({ pickup_address: "x" }),
    (err) => err instanceof RideActionError && err.code === "invalid_input"
  );
});

test("fareEstimateCentsFromTripKm uses rand_per_km default", () => {
  const cents = fareEstimateCentsFromTripKm(10);
  assert.equal(cents, 12000);
});

test("splitFareCents applies owner commission", () => {
  const split = splitFareCents(10_000);
  assert.equal(split.owner_commission_cents + split.driver_earnings_cents, 10_000);
  assert.ok(split.owner_commission_cents > 0);
});

test("RideActionError carries http status", () => {
  const err = new RideActionError("not_found", "missing", 404);
  assert.equal(err.code, "not_found");
  assert.equal(err.httpStatus, 404);
});
