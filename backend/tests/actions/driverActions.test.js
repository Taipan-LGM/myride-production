import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DriverActionError,
  normalizeLocationInput,
  parseOnlineFromPayload,
} from "../../actions/driverActions.js";

test("parseOnlineFromPayload handles socket aliases", () => {
  assert.equal(parseOnlineFromPayload({ online: true }), true);
  assert.equal(parseOnlineFromPayload({ online: 1 }), true);
  assert.equal(parseOnlineFromPayload({ status: "online" }), true);
  assert.equal(parseOnlineFromPayload({ is_online: true }), true);
  assert.equal(parseOnlineFromPayload({ status: "offline" }), false);
  assert.equal(parseOnlineFromPayload({ online: false }), false);
  assert.equal(parseOnlineFromPayload({}), false);
});

test("normalizeLocationInput maps Flutter location object", () => {
  const loc = normalizeLocationInput({
    location: { lat: -33.92, lng: 25.57 },
    bearing: 90,
  });
  assert.equal(loc.lat, -33.92);
  assert.equal(loc.lng, 25.57);
  assert.equal(loc.bearing, 90);
});

test("normalizeLocationInput rejects missing coordinates", () => {
  assert.throws(
    () => normalizeLocationInput({ lat: 1 }),
    (err) => err instanceof DriverActionError && err.code === "invalid_coordinates"
  );
});

test("DriverActionError carries http status", () => {
  const err = new DriverActionError("not_found", "missing", 404);
  assert.equal(err.code, "not_found");
  assert.equal(err.httpStatus, 404);
});
