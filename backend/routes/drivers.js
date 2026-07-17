import express from "express";
import { authRequired, roleRequired } from "../middleware/auth.js";
import { sendSuccess } from "../lib/apiResponse.js";
import { findNearbyDrivers } from "../actions/rideActions.js";
import {
  applyDriverApplication,
  formatDriverProfile,
  getDriverEarnings,
  getDriverRideHistory,
  persistDriverLocation,
  setDriverOnline,
} from "../actions/driverActions.js";
import { DriverError } from "../errors/index.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import {
  driverApplicationBodySchema,
  driverEarningsQuerySchema,
  driverHistoryQuerySchema,
  driverLocationBodySchema,
  driverStatusBodySchema,
  nearbyDriversQuerySchema,
} from "../validation/index.js";
import { EVENTS } from "../socket/utils/constants.js";

const router = express.Router();

function broadcastDriverStatus(io, driverUserId, online) {
  if (!io) return;
  io.to("admin").emit(EVENTS.DRIVER_STATUS_CHANGED, {
    driver_id: String(driverUserId),
    online: Boolean(online),
  });
}

function handleStatusUpdate(req, res, next) {
  try {
    const result = setDriverOnline(req.user.id, req.body);
    broadcastDriverStatus(req.app.locals.io, req.user.id, result.online);

    if (result.online && (req.body.lat != null || req.body.location)) {
      const locationService = req.app.locals.locationService;
      const persisted = persistDriverLocation(req.user.id, req.body);
      locationService?.broadcastDriverLocation(req.user.id, persisted, req.body);
    }

    return sendSuccess(res, {
      driver_id: String(req.user.id),
      online: result.online,
      is_available: result.online,
      shift_summary: result.shift_summary,
      driver_profile: formatDriverProfile(req.user.id),
    });
  } catch (err) {
    next(err);
  }
}

function handleLocationUpdate(req, res, next) {
  try {
    const body = req.body;
    let onlineResult = null;

    if (
      body.online !== undefined ||
      body.status !== undefined ||
      body.is_online !== undefined
    ) {
      onlineResult = setDriverOnline(req.user.id, body);
      broadcastDriverStatus(req.app.locals.io, req.user.id, onlineResult.online);
    }

    const locationService = req.app.locals.locationService;
    const persisted = persistDriverLocation(req.user.id, body);
    locationService?.broadcastDriverLocation(req.user.id, persisted, body);

    const profile = formatDriverProfile(req.user.id);
    return sendSuccess(res, {
      driver_id: String(req.user.id),
      lat: persisted.lat,
      lng: persisted.lng,
      bearing: body.bearing ?? 0,
      speed: body.speed ?? 0,
      online: onlineResult?.online ?? Boolean(profile?.online),
      shift_summary: onlineResult?.shift_summary ?? null,
      driver_profile: profile,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
}

function getProfileHandler(req, res, next) {
  try {
    const profile = formatDriverProfile(req.user.id);
    if (!profile) throw new DriverError("RES_003", { driver_id: req.user.id });
    return sendSuccess(res, profile);
  } catch (err) {
    next(err);
  }
}

router.get("/profile", authRequired, roleRequired("driver"), getProfileHandler);
router.get("/me", authRequired, roleRequired("driver"), getProfileHandler);

router.post(
  "/status",
  authRequired,
  roleRequired("driver"),
  validateBody(driverStatusBodySchema),
  handleStatusUpdate
);
router.put(
  "/status",
  authRequired,
  roleRequired("driver"),
  validateBody(driverStatusBodySchema),
  handleStatusUpdate
);

router.post(
  "/location",
  authRequired,
  roleRequired("driver"),
  validateBody(driverLocationBodySchema),
  handleLocationUpdate
);
router.patch(
  "/location",
  authRequired,
  roleRequired("driver"),
  validateBody(driverLocationBodySchema),
  handleLocationUpdate
);

router.post(
  "/apply",
  authRequired,
  roleRequired("customer"),
  validateBody(driverApplicationBodySchema),
  (req, res, next) => {
    try {
      const result = applyDriverApplication(req.user, req.body);
      return sendSuccess(res, result, 201);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  "/earnings",
  authRequired,
  roleRequired("driver"),
  validateQuery(driverEarningsQuerySchema),
  (req, res, next) => {
    try {
      return sendSuccess(res, getDriverEarnings(req.user.id, req.query.period));
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  "/rides",
  authRequired,
  roleRequired("driver"),
  validateQuery(driverHistoryQuerySchema),
  (req, res, next) => {
    try {
      return sendSuccess(res, getDriverRideHistory(req.user.id, req.query));
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  "/nearby",
  authRequired,
  roleRequired("admin"),
  validateQuery(nearbyDriversQuerySchema),
  (req, res, next) => {
    try {
      const { lat, lng, radius, vehicle_type, limit } = req.query;
      const result = findNearbyDrivers({
        lat,
        lng,
        radiusM: radius ?? 5000,
        vehicleType: vehicle_type,
        limit: limit ?? 20,
      });
      return sendSuccess(res, {
        ...result,
        query: { lat, lng, radius: radius ?? 5000, limit: limit ?? 20, vehicle_type },
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
