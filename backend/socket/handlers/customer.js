import { db } from "../../database.js";
import { EVENTS } from "../utils/constants.js";
import { getActiveRideForUser } from "../../services/rideSocketService.js";

/**
 * Register customer (rider) socket events.
 */
export function registerCustomerHandlers(socket, deps) {
  const { user, locationService, rateLimit } = deps;

  socket.on(EVENTS.LOCATION_REQUEST, (payload) => {
    if (user.role !== "customer") return;
    if (!rateLimit(socket, EVENTS.LOCATION_REQUEST)) return;

    const rideId = Number(payload?.ride_id);
    let ride = null;

    if (Number.isFinite(rideId)) {
      ride = db.prepare("SELECT * FROM rides WHERE id=?").get(rideId);
      if (!ride || ride.customer_id !== user.id) return;
    } else {
      ride = getActiveRideForUser(user);
    }

    if (!ride?.driver_id) return;
    locationService.emitLocationToCustomer(ride, ride.driver_id);
  });
}
