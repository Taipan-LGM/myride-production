import { db } from "../../database.js";
import { logger } from "../../lib/logger.js";
import { EVENTS } from "../utils/constants.js";
import {
  acceptRide,
  cancelRide,
  completeRide,
  createRide,
  rejectRide,
  RideActionError,
  startRide,
} from "../../actions/rideActions.js";
import { buildRideMatchedPayload } from "../../services/rideSocketService.js";

function parseRideId(payload) {
  const id = Number(payload?.ride_id ?? payload?.rideId);
  return Number.isFinite(id) ? id : null;
}

function emitActionError(socket, eventName, err) {
  if (err instanceof RideActionError) {
    socket.emit(EVENTS.SOCKET_ERROR, {
      event: eventName,
      error: err.code,
      message: err.message,
    });
    return;
  }
  logger.error(`Socket ${eventName} failed`, err);
  socket.emit(EVENTS.SOCKET_ERROR, {
    event: eventName,
    error: "server_error",
    message: "Unexpected error",
  });
}

/**
 * Ride mutations via shared RideActions (HTTP + Socket parity).
 */
export function registerRideMutationHandlers(socket, deps) {
  const { user, io, roomManager } = deps;

  if (user.role === "customer") {
    socket.on(EVENTS.RIDE_REQUEST, async (payload) => {
      try {
        const ride = await createRide(user.id, payload, { io });
        socket.emit("ride:created", {
          ride_id: String(ride.id),
          status: ride.status,
          ride,
        });
        if (ride.driver_id) {
          roomManager.joinRideSocket(socket, ride.id, ride.customer_id, ride.driver_id);
        }
      } catch (err) {
        emitActionError(socket, EVENTS.RIDE_REQUEST, err);
      }
    });

    socket.on(EVENTS.RIDE_CANCEL, async (payload) => {
      const rideId = parseRideId(payload);
      if (!rideId) return;
      try {
        const ride = cancelRide(rideId, user, {
          reason: payload?.reason,
          io,
        });
        roomManager.removeRideRoom(ride.id);
        socket.emit(EVENTS.RIDE_CANCELLED, { ride, reason: payload?.reason ?? null });
      } catch (err) {
        emitActionError(socket, EVENTS.RIDE_CANCEL, err);
      }
    });
  }

  if (user.role === "driver") {
    socket.on(EVENTS.RIDE_ACCEPT, async (payload) => {
      const rideId = parseRideId(payload);
      if (!rideId) return;
      try {
        const ride = acceptRide(rideId, user.id, { io });
        roomManager.joinRideSocket(socket, ride.id, ride.customer_id, ride.driver_id);
        socket.emit("ride:accepted", {
          ride_id: String(ride.id),
          status: ride.status,
          ride,
        });
        io.to(`customer:${ride.customer_id}`).emit(
          EVENTS.RIDE_MATCHED,
          buildRideMatchedPayload(ride)
        );
      } catch (err) {
        emitActionError(socket, EVENTS.RIDE_ACCEPT, err);
      }
    });

    socket.on(EVENTS.RIDE_DECLINE, async (payload) => {
      const rideId = parseRideId(payload);
      if (!rideId) return;
      try {
        const ride = rejectRide(rideId, user.id, { io });
        socket.emit("ride:declined", {
          ride_id: String(ride.id),
          reason: payload?.reason || "Driver declined",
        });
      } catch (err) {
        emitActionError(socket, EVENTS.RIDE_DECLINE, err);
      }
    });

    socket.on(EVENTS.RIDE_START, async (payload) => {
      const rideId = parseRideId(payload);
      if (!rideId) return;
      try {
        const ride = startRide(rideId, user.id, { io });
        io.to(`ride:${ride.id}`).emit("ride:started", {
          ride_id: String(ride.id),
          status: ride.status,
        });
      } catch (err) {
        emitActionError(socket, EVENTS.RIDE_START, err);
      }
    });

    socket.on(EVENTS.RIDE_COMPLETE, async (payload) => {
      const rideId = parseRideId(payload);
      if (!rideId) return;
      try {
        const ride = completeRide(rideId, user.id, { io });
        io.to(`ride:${ride.id}`).emit("ride:completed", {
          ride_id: String(ride.id),
          status: ride.status,
        });
        setTimeout(() => roomManager.removeRideRoom(ride.id), 5000);
      } catch (err) {
        emitActionError(socket, EVENTS.RIDE_COMPLETE, err);
      }
    });
  }
}
