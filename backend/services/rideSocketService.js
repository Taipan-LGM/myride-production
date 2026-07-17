import { db } from "../database.js";

const ACTIVE_RIDE_STATUSES = [
  "matched",
  "accepted",
  "arriving",
  "in_progress",
];

export function isSocketEventsEnabled() {
  const flag = process.env.ENABLE_SOCKET_EVENTS;
  if (flag === "0" || flag === "false") return false;
  return true;
}

export function getActiveRideForUser(user) {
  if (user.role === "customer") {
    return db
      .prepare(
        `
        SELECT * FROM rides
        WHERE customer_id = ?
          AND status IN ('matched','accepted','arriving','in_progress')
        ORDER BY id DESC
        LIMIT 1
      `
      )
      .get(user.id);
  }
  if (user.role === "driver") {
    return db
      .prepare(
        `
        SELECT * FROM rides
        WHERE driver_id = ?
          AND status IN ('matched','accepted','arriving','in_progress')
        ORDER BY id DESC
        LIMIT 1
      `
      )
      .get(user.id);
  }
  return null;
}

export function joinActiveRideRoom(socket, user) {
  if (!isSocketEventsEnabled()) return;
  const ride = getActiveRideForUser(user);
  if (ride) socket.join(`ride:${ride.id}`);
}

function driverProfileForRide(driverUserId) {
  if (!driverUserId) return null;
  return db
    .prepare(
      `
      SELECT u.id, u.name, dp.license_plate, dp.vehicle_type, dp.lat, dp.lng, dp.photo_url
      FROM users u
      JOIN driver_profiles dp ON dp.user_id = u.id
      WHERE u.id = ?
    `
    )
    .get(driverUserId);
}

export function buildRideIncomingPayload(ride) {
  const customer = db
    .prepare("SELECT id, name FROM users WHERE id = ?")
    .get(ride.customer_id);

  return {
    ride_id: String(ride.id),
    pickup: {
      address: ride.pickup_text,
      lat: ride.pickup_lat,
      lng: ride.pickup_lng,
    },
    dropoff: {
      address: ride.dropoff_text,
      lat: ride.dropoff_lat,
      lng: ride.dropoff_lng,
    },
    distance: ride.distance_km != null ? Number(ride.distance_km) * 1000 : null,
    estimated_fare: ride.fare_estimate_cents,
    vehicle_type: ride.vehicle_type,
    rider_info: {
      name: customer?.name || "Rider",
      rating: null,
    },
    timeout: 30_000,
  };
}

export function buildRideMatchedPayload(ride) {
  const driver = driverProfileForRide(ride.driver_id);
  if (!driver) {
    return { ride_id: String(ride.id), driver: null };
  }

  return {
    ride_id: String(ride.id),
    driver: {
      id: String(driver.id),
      name: driver.name,
      phone: null,
      rating: null,
      vehicle: {
        plate: driver.license_plate,
        vehicle_type: driver.vehicle_type,
      },
      location: {
        lat: driver.lat,
        lng: driver.lng,
        bearing: null,
      },
      eta_to_pickup: null,
    },
  };
}

export function emitRideUpdated(io, ride) {
  if (!io || !ride) return;
  const payload = { ride };
  io.to(`user:${ride.customer_id}`).emit("ride:updated", payload);
  if (ride.driver_id) {
    io.to(`driver:${ride.driver_id}`).emit("ride:updated", payload);
  }
  io.to(`ride:${ride.id}`).emit("ride:updated", payload);
  io.to("admin").emit("ride:updated", payload);

  if (isSocketEventsEnabled()) {
    const statusPayload = {
      ride_id: String(ride.id),
      status: ride.status,
      driver_id: ride.driver_id ? String(ride.driver_id) : null,
      customer_id: String(ride.customer_id),
      updated_at: ride.updated_at || new Date().toISOString(),
    };
    io.to(`user:${ride.customer_id}`).emit("ride:status_update", statusPayload);
    if (ride.driver_id) {
      io.to(`driver:${ride.driver_id}`).emit("ride:status_update", statusPayload);
    }
    io.to(`ride:${ride.id}`).emit("ride:status_update", statusPayload);
    io.to("admin").emit("ride:status_update", statusPayload);
  }
}

export function emitRideRequestToDriver(io, ride, driverUserId) {
  if (!io || !ride || !driverUserId) return;
  const payload = { ride };
  io.to(`driver:${driverUserId}`).emit("ride:request", payload);
  if (isSocketEventsEnabled()) {
    io.to(`driver:${driverUserId}`).emit(
      "ride:incoming",
      buildRideIncomingPayload(ride)
    );
  }
}

export function emitRideMatched(io, ride) {
  if (!io || !ride || !isSocketEventsEnabled()) return;
  const payload = buildRideMatchedPayload(ride);
  io.to(`user:${ride.customer_id}`).emit("ride:matched", payload);
  io.to(`customer:${ride.customer_id}`).emit("ride:matched", payload);
  io.to(`ride:${ride.id}`).emit("ride:matched", payload);
}

export function emitRideCancelled(io, ride, reason) {
  if (!io || !ride) return;
  const payload = { ride, reason: reason || null };
  io.to(`user:${ride.customer_id}`).emit("ride:cancelled", payload);
  if (ride.driver_id) {
    io.to(`driver:${ride.driver_id}`).emit("ride:cancelled", payload);
  }
  io.to(`ride:${ride.id}`).emit("ride:cancelled", payload);
}

export function emitDriverLocationUpdate(io, ride, location) {
  if (!io || !ride || !isSocketEventsEnabled()) return;

  const payload = {
    ride_id: String(ride.id),
    driver_id: String(ride.driver_id),
    location: {
      lat: location.lat,
      lng: location.lng,
      bearing: location.bearing ?? null,
      speed: location.speed ?? null,
      timestamp: location.timestamp || new Date().toISOString(),
    },
  };

  io.to(`user:${ride.customer_id}`).emit("driver:location_update", payload);
  io.to(`customer:${ride.customer_id}`).emit("driver:location_update", payload);
  io.to(`ride:${ride.id}`).emit("driver:location_update", payload);
}

export function getActiveRideForDriver(driverUserId) {
  return db
    .prepare(
      `
      SELECT * FROM rides
      WHERE driver_id = ?
        AND status IN (${ACTIVE_RIDE_STATUSES.map(() => "?").join(", ")})
      ORDER BY id DESC
      LIMIT 1
    `
    )
    .get(driverUserId, ...ACTIVE_RIDE_STATUSES);
}

/** Push active ride state after reconnect (Flutter `ride:restored`). */
export function emitRideRestored(io, socket, user, ride) {
  if (!io || !socket || !ride || !isSocketEventsEnabled()) return;

  const payload = {
    ride_id: String(ride.id),
    status: ride.status,
    ride,
  };

  if (user.role === "customer" && ride.customer_id === user.id) {
    if (ride.driver_id && ["matched", "accepted", "arriving"].includes(ride.status)) {
      payload.matched = buildRideMatchedPayload(ride);
    }
    socket.emit("ride:restored", payload);
    return;
  }

  if (user.role === "driver" && ride.driver_id === user.id) {
    socket.emit("ride:restored", payload);
  }
}
