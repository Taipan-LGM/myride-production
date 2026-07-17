import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VEHICLE_TYPE_MAP,
  VALID_DB_TYPES,
  VALID_RIDE_TYPES,
  mapVehicleTypeForRide,
  mapVehicleType,
  isValidDBType,
  isValidRideType,
  normalizeVehicleType,
} from "../../utils/vehicleTypes.js";

test("VEHICLE_TYPE_MAP aliases + pass-through", () => {
  assert.equal(VEHICLE_TYPE_MAP.standard, "Car");
  assert.equal(VEHICLE_TYPE_MAP.premium, "Car");
  assert.equal(VEHICLE_TYPE_MAP.xl, "MPV");
  assert.equal(VEHICLE_TYPE_MAP.bike, "Bike");
  assert.equal(VEHICLE_TYPE_MAP.Car, "Car");
  assert.equal(VEHICLE_TYPE_MAP.MPV, "MPV");
  assert.equal(VEHICLE_TYPE_MAP.Bike, "Bike");
  assert.deepEqual(VALID_DB_TYPES, ["Car", "MPV", "Bike"]);
  assert.ok(VALID_RIDE_TYPES.includes("standard"));
  assert.ok(VALID_RIDE_TYPES.includes("xl"));
  assert.ok(!VALID_RIDE_TYPES.includes("Auto"));
});

test("mapVehicleTypeForRide returns Car|MPV|Bike", () => {
  assert.equal(mapVehicleTypeForRide("standard"), "Car");
  assert.equal(mapVehicleTypeForRide("premium"), "Car");
  assert.equal(mapVehicleTypeForRide("xl"), "MPV");
  assert.equal(mapVehicleTypeForRide("bike"), "Bike");
  assert.equal(mapVehicleTypeForRide("Car"), "Car");
  assert.equal(mapVehicleTypeForRide("MPV"), "MPV");
  assert.equal(mapVehicleTypeForRide("Bike"), "Bike");
  assert.equal(mapVehicleTypeForRide("unknown"), "Car");
  assert.equal(mapVehicleTypeForRide(undefined), "Car");
});

test("mapVehicleType / normalizeVehicleType", () => {
  assert.equal(mapVehicleType("standard"), "Car");
  assert.equal(mapVehicleType("bike"), "Bike");
  assert.equal(mapVehicleType("unknown"), "Car");
  assert.equal(normalizeVehicleType("standard"), "Car");
  assert.equal(normalizeVehicleType("xl"), "MPV");
  assert.equal(normalizeVehicleType("bike"), "Bike");
  assert.equal(normalizeVehicleType(undefined), "Car");
});

test("isValidDBType / isValidRideType", () => {
  assert.equal(isValidDBType("Car"), true);
  assert.equal(isValidDBType("MPV"), true);
  assert.equal(isValidDBType("Bike"), true);
  assert.equal(isValidDBType("standard"), false);
  assert.equal(isValidRideType("standard"), true);
  assert.equal(isValidRideType("xl"), true);
  assert.equal(isValidRideType("Car"), true);
  assert.equal(isValidRideType("unknown"), false);
});
