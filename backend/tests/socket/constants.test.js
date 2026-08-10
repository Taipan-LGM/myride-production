import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EVENTS, ROOM, TIMING } from "../../socket/utils/constants.js";
import { RoomManager } from "../../socket/services/roomManager.js";

describe("socket constants", () => {
  it("exposes legacy driver event names", () => {
    assert.equal(EVENTS.DRIVER_SET_ONLINE, "driver:setOnline");
    assert.equal(EVENTS.DRIVER_UPDATE_LOCATION, "driver:updateLocation");
  });

  it("exposes Flutter contract aliases", () => {
    assert.equal(EVENTS.DRIVER_STATUS, "driver:status");
    assert.equal(EVENTS.DRIVER_LOCATION, "driver:location");
    assert.equal(EVENTS.RIDE_STATUS_UPDATE, "ride:status_update");
    assert.equal(EVENTS.RIDE_ETA_UPDATE, "ride:eta_update");
  });

  it("builds room names", () => {
    assert.equal(ROOM.ride(42), "ride:42");
    assert.equal(ROOM.customer(7), "customer:7");
  });

  it("defines timing defaults", () => {
    assert.equal(TIMING.LOCATION_MIN_INTERVAL_MS, 2000);
    assert.equal(TIMING.RIDE_TIMEOUT_MS, 30_000);
  });
});

describe("RoomManager", () => {
  it("registers and removes ride rooms", () => {
    const rm = new RoomManager();
    const name = rm.registerRideRoom(1, 10, 20);
    assert.equal(name, "ride:1");
    assert.ok(rm.getRideRoom(1));
    rm.removeRideRoom(1);
    assert.equal(rm.getRideRoom(1), undefined);
  });
});
