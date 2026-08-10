import { db } from "../../database.js";
import { EVENTS } from "../utils/constants.js";
import {
  emitRideRestored,
  getActiveRideForUser,
  isSocketEventsEnabled,
} from "../../services/rideSocketService.js";

/**
 * Join a ride room when client explicitly requests (reconnect / deep link).
 */
export function handleRideJoin(socket, user, payload, roomManager) {
  const rideId = Number(payload?.ride_id);
  if (!Number.isFinite(rideId)) return;

  const ride = db.prepare("SELECT * FROM rides WHERE id=?").get(rideId);
  if (!ride) return;

  const allowed =
    (user.role === "customer" && ride.customer_id === user.id) ||
    (user.role === "driver" && ride.driver_id === user.id);

  if (!allowed) return;

  roomManager.joinRideSocket(
    socket,
    rideId,
    ride.customer_id,
    ride.driver_id
  );
}

/**
 * On connect: join active ride room and push restore payload.
 */
export function handleConnectionRestore(socket, user, io, roomManager) {
  if (!isSocketEventsEnabled()) return;

  const ride = getActiveRideForUser(user);
  if (!ride) return;

  roomManager.joinRideSocket(
    socket,
    ride.id,
    ride.customer_id,
    ride.driver_id
  );
  emitRideRestored(io, socket, user, ride);
}

/**
 * Register shared ride room events.
 */
export function registerRideHandlers(socket, deps) {
  const { user, roomManager } = deps;

  socket.on(EVENTS.RIDE_JOIN, (payload) => {
    handleRideJoin(socket, user, payload, roomManager);
    const rideId = Number(payload?.ride_id);
    if (!Number.isFinite(rideId)) return;
    const ride = db.prepare("SELECT * FROM rides WHERE id=?").get(rideId);
    if (ride) emitRideRestored(deps.io, socket, user, ride);
  });
}
