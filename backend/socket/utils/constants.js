/** Socket event names — legacy + Flutter contract aliases. */
export const EVENTS = {
  CONNECTION: "connection",
  DISCONNECT: "disconnect",

  // Driver → server (legacy names kept)
  DRIVER_SET_ONLINE: "driver:setOnline",
  DRIVER_UPDATE_LOCATION: "driver:updateLocation",

  // Driver → server (Flutter contract aliases)
  DRIVER_STATUS: "driver:status",
  DRIVER_LOCATION: "driver:location",
  RIDE_ACCEPT: "ride:accept",
  RIDE_DECLINE: "ride:decline",
  RIDE_START: "ride:start",
  RIDE_COMPLETE: "ride:complete",

  // Customer → server
  RIDE_JOIN: "ride:join",
  RIDE_REQUEST: "ride:request",
  RIDE_CANCEL: "ride:cancel",
  LOCATION_REQUEST: "location:request",

  // Server → client
  HELLO: "hello",
  DRIVER_ONLINE_STATUS: "driver:onlineStatus",
  DRIVER_SHIFT_SUMMARY: "driver:shiftSummary",
  DRIVER_LOCATION_UPDATED: "driver:locationUpdated",
  RIDE_REQUEST_LEGACY: "ride:request",
  RIDE_INCOMING: "ride:incoming",
  RIDE_UPDATED: "ride:updated",
  RIDE_STATUS_UPDATE: "ride:status_update",
  RIDE_MATCHED: "ride:matched",
  RIDE_CANCELLED: "ride:cancelled",
  RIDE_RESTORED: "ride:restored",
  DRIVER_LOCATION_UPDATE: "driver:location_update",
  RIDE_ETA_UPDATE: "ride:eta_update",
  DRIVER_STATUS_CHANGED: "driver:status_changed",
  SOCKET_ERROR: "socket:error",
};

export const ROOM = {
  user: (id) => `user:${id}`,
  driver: (id) => `driver:${id}`,
  customer: (id) => `customer:${id}`,
  ride: (id) => `ride:${id}`,
  admin: "admin",
  role: (role) => `role:${role}`,
};

export const TIMING = {
  RIDE_TIMEOUT_MS: 30_000,
  LOCATION_MIN_INTERVAL_MS: 2000,
  ETA_MIN_INTERVAL_MS: 30_000,
  STALE_ROOM_MS: 3_600_000,
};
