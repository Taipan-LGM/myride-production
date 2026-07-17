import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AppError,
  RideError,
  ValidationError,
  resolveHttpError,
} from "../../errors/index.js";
import { RideActionError } from "../../actions/rideActions.js";

test("AppError serializes structured response", () => {
  const err = new RideError("RIDE_001", { ride_id: 1 });
  const json = err.toJSON();
  assert.equal(json.success, false);
  assert.equal(json.error.code, "RIDE_001");
});

test("ValidationError includes field details", () => {
  const err = new ValidationError([{ field: "lat", message: "required" }]);
  assert.equal(err.validationErrors[0].field, "lat");
});

test("resolveHttpError maps legacy RideActionError", () => {
  const err = new RideActionError("active_ride_exists", "You already have an active ride", 400);
  const { status, body } = resolveHttpError(err);
  assert.equal(status, 400);
  assert.equal(body.error.code, "RIDE_001");
  assert.equal(body.error.legacy_code, "active_ride_exists");
});

test("resolveHttpError handles unknown errors in production mode", () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const { status, body } = resolveHttpError(new Error("secret"));
  process.env.NODE_ENV = prev;
  assert.equal(status, 500);
  assert.equal(body.error.code, "SVR_001");
  assert.notEqual(body.error.message, "secret");
});
