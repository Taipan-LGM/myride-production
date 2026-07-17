import { logger } from "../../lib/logger.js";
import { setDriverOnline } from "../../actions/driverActions.js";
import { EVENTS } from "../utils/constants.js";

/**
 * Register driver socket events (legacy + Flutter aliases).
 */
export function registerDriverHandlers(socket, deps) {
  const { user, io, locationService, locationThrottle, rateLimit } = deps;

  const onSetOnline = (payload) => {
    if (user.role !== "driver") return;
    if (!rateLimit(socket, EVENTS.DRIVER_SET_ONLINE)) return;

    try {
      const result = setDriverOnline(user.id, payload);
      socket.emit(EVENTS.DRIVER_ONLINE_STATUS, { online: result.online });
      if (result.shift_summary) {
        socket.emit(EVENTS.DRIVER_SHIFT_SUMMARY, result.shift_summary);
      }
      io.to("admin").emit(EVENTS.DRIVER_STATUS_CHANGED, {
        driver_id: String(user.id),
        online: result.online,
      });
    } catch (err) {
      logger.error("driver setOnline failed", err);
      socket.emit(EVENTS.SOCKET_ERROR, {
        event: EVENTS.DRIVER_SET_ONLINE,
        error: err?.code || "server_error",
        message: err?.message || "Could not update online status",
      });
    }
  };

  socket.on(EVENTS.DRIVER_SET_ONLINE, onSetOnline);
  socket.on(EVENTS.DRIVER_STATUS, (payload) => {
    const online =
      payload?.status === "online" ||
      payload?.online === true ||
      payload?.online === 1;
    onSetOnline({ online });
  });

  const onLocation = (payload) => {
    if (user.role !== "driver") return;
    if (!rateLimit(socket, EVENTS.DRIVER_UPDATE_LOCATION)) return;
    if (!locationThrottle(user.id)) return;

    try {
      const result = locationService.updateDriverLocation(user.id, payload);
      socket.emit(EVENTS.DRIVER_LOCATION_UPDATED, {
        lat: result.lat,
        lng: result.lng,
      });
    } catch (err) {
      if (err?.code === "invalid_coordinates" || err?.message === "invalid_coordinates") {
        socket.emit(EVENTS.SOCKET_ERROR, {
          event: EVENTS.DRIVER_UPDATE_LOCATION,
          error: "invalid_coordinates",
        });
      } else {
        logger.error("driver location update failed", err);
        socket.emit(EVENTS.SOCKET_ERROR, {
          event: EVENTS.DRIVER_UPDATE_LOCATION,
          error: err?.code || "server_error",
          message: err?.message || "Location update failed",
        });
      }
    }
  };

  socket.on(EVENTS.DRIVER_UPDATE_LOCATION, onLocation);
  socket.on(EVENTS.DRIVER_LOCATION, onLocation);
}
