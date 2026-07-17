import { db } from "../../database.js";
import { haversineMeters } from "../../lib/geo.js";
import { logger } from "../../lib/logger.js";
import { persistDriverLocation } from "../../actions/driverActions.js";
import { TIMING } from "../utils/constants.js";
import {
  emitDriverLocationUpdate,
} from "../../services/rideSocketService.js";

export class LocationService {
  constructor(io) {
    this.io = io;
    /** @type {Map<number, number>} driverId → last ETA emit timestamp */
    this.lastEtaEmit = new Map();
  }

  /**
   * Persist GPS and broadcast to rider when on an active ride.
   * @returns {{ lat: number, lng: number, ride: object|null }}
   */
  updateDriverLocation(driverUserId, payload) {
    const result = persistDriverLocation(driverUserId, payload);
    this.broadcastDriverLocation(driverUserId, result, payload);
    return { lat: result.lat, lng: result.lng, ride: result.activeRide };
  }

  /**
   * Socket / HTTP broadcast after location is already persisted.
   */
  broadcastDriverLocation(driverUserId, persisted, payload = {}) {
    const { lat, lng, activeRide, bearing, speed } = persisted;

    if (activeRide) {
      emitDriverLocationUpdate(this.io, activeRide, {
        lat,
        lng,
        bearing,
        speed,
        timestamp: new Date().toISOString(),
      });
      this.maybeEmitEta(activeRide, lat, lng);
    }
  }

  maybeEmitEta(ride, driverLat, driverLng) {
    if (!ride?.driver_id) return;
    const now = Date.now();
    const last = this.lastEtaEmit.get(ride.driver_id) || 0;
    if (now - last < TIMING.ETA_MIN_INTERVAL_MS) return;
    this.lastEtaEmit.set(ride.driver_id, now);

    const toPickup = haversineMeters(
      driverLat,
      driverLng,
      ride.pickup_lat,
      ride.pickup_lng
    );
    const toDropoff = haversineMeters(
      driverLat,
      driverLng,
      ride.dropoff_lat,
      ride.dropoff_lng
    );
    const avgSpeedMps = 8.33;
    const payload = {
      ride_id: String(ride.id),
      eta_to_pickup: Math.round(toPickup / avgSpeedMps),
      eta_to_dropoff: Math.round(toDropoff / avgSpeedMps),
      distance_remaining: Math.round(toDropoff),
    };

    this.io.to(`ride:${ride.id}`).emit("ride:eta_update", payload);
    this.io.to(`user:${ride.customer_id}`).emit("ride:eta_update", payload);
    this.io.to(`customer:${ride.customer_id}`).emit("ride:eta_update", payload);
  }

  emitLocationToCustomer(ride, driverUserId) {
    const profile = db
      .prepare("SELECT lat, lng FROM driver_profiles WHERE user_id=?")
      .get(driverUserId);
    if (!profile?.lat || !profile?.lng) {
      logger.debug("location:request — no driver GPS", { rideId: ride.id });
      return false;
    }
    emitDriverLocationUpdate(this.io, ride, {
      lat: profile.lat,
      lng: profile.lng,
      timestamp: new Date().toISOString(),
    });
    return true;
  }

  getStats() {
    return {
      etaTracking: this.lastEtaEmit.size,
    };
  }
}
