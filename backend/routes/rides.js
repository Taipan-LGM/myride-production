import express from "express";
import { authRequired, roleRequired } from "../middleware/auth.js";
import cache, { isNearbyCacheEnabled, nearbyCacheKey } from "../lib/cache.js";
import { logger } from "../lib/logger.js";
import { sendSuccess } from "../lib/apiResponse.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validate.js";
import {
  cancelRideBodySchema,
  completeRideBodySchema,
  createRideBodySchema,
  nearbyDriversQuerySchema,
  rideHistoryQuerySchema,
  rideIdParamSchema,
} from "../validation/index.js";
import {
  acceptRide,
  cancelRide,
  completeRide,
  createRide,
  findNearbyDrivers,
  getRideForUser,
  getRideHistoryForUser,
  listRidesForUser,
  rejectRide,
  requestRidePayment,
  startRide,
} from "../actions/rideActions.js";

const router = express.Router();

const createRideHandler = async (req, res, next) => {
  try {
    const ride = await createRide(req.user.id, req.body, { io: req.app.locals.io });
    return sendSuccess(
      res,
      {
        ride_id: String(ride.id),
        status: ride.status,
        ride,
      },
      201
    );
  } catch (err) {
    next(err);
  }
};

router.post(
  "/",
  authRequired,
  roleRequired("customer"),
  validateBody(createRideBodySchema),
  createRideHandler
);
router.post(
  "/request",
  authRequired,
  roleRequired("customer"),
  validateBody(createRideBodySchema),
  createRideHandler
);

router.get("/mine", authRequired, (req, res, next) => {
  try {
    return sendSuccess(res, { rides: listRidesForUser(req.user) });
  } catch (err) {
    next(err);
  }
});

router.get(
  "/history",
  authRequired,
  validateQuery(rideHistoryQuerySchema),
  (req, res, next) => {
    try {
      return sendSuccess(res, getRideHistoryForUser(req.user, req.query));
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  "/nearby",
  authRequired,
  roleRequired("customer", "admin"),
  validateQuery(nearbyDriversQuerySchema),
  (req, res, next) => {
    const startTime = Date.now();
    const { lat, lng, radius, vehicle_type, limit } = req.query;
    const radiusM = radius ?? 5000;
    const queryLimit = limit ?? 20;

    try {
      const cacheKey = nearbyCacheKey({
        lat,
        lng,
        radiusM,
        vehicleType: vehicle_type,
        limit: queryLimit,
      });

      if (isNearbyCacheEnabled()) {
        const cached = cache.get(cacheKey);
        if (cached) {
          return res.json({
            success: true,
            data: cached,
            cached: true,
            query: { lat, lng, radius: radiusM, limit: queryLimit, vehicle_type },
            performance: { duration_ms: Date.now() - startTime },
          });
        }
      }

      const result = findNearbyDrivers({
        lat,
        lng,
        radiusM,
        vehicleType: vehicle_type,
        limit: queryLimit,
      });

      if (isNearbyCacheEnabled()) {
        const ttl = Number(process.env.CACHE_TTL_NEARBY) || 3000;
        cache.set(cacheKey, result, ttl);
      }

      logger.info("Nearby drivers query", {
        lat,
        lng,
        radius: radiusM,
        count: result.total,
        duration_ms: Date.now() - startTime,
      });

      return res.json({
        success: true,
        data: result,
        cached: false,
        query: { lat, lng, radius: radiusM, limit: queryLimit, vehicle_type },
        performance: { duration_ms: Date.now() - startTime },
      });
    } catch (err) {
      if (err?.message === "invalid_coordinates") {
        return res.status(400).json({
          success: false,
          error: { code: "LOC_001", message: "Invalid coordinates" },
        });
      }
      if (process.env.ENABLE_NEARBY_DRIVERS === "0") {
        return res.json({
          success: true,
          data: { drivers: [], total: 0, query_radius: radiusM, query_limit: queryLimit },
          cached: false,
        });
      }
      next(err);
    }
  }
);

router.get("/:id", authRequired, validateParams(rideIdParamSchema), (req, res, next) => {
  try {
    return sendSuccess(res, getRideForUser(req.params.id, req.user));
  } catch (err) {
    next(err);
  }
});

router.post(
  "/:id/accept",
  authRequired,
  roleRequired("driver"),
  validateParams(rideIdParamSchema),
  (req, res, next) => {
    try {
      const ride = acceptRide(req.params.id, req.user.id, { io: req.app.locals.io });
      return sendSuccess(res, { ride_id: String(ride.id), status: ride.status, ride });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/:id/cancel",
  authRequired,
  validateParams(rideIdParamSchema),
  validateBody(cancelRideBodySchema),
  (req, res, next) => {
    try {
      const ride = cancelRide(req.params.id, req.user, {
        reason: req.body.reason || null,
        io: req.app.locals.io,
      });
      return sendSuccess(res, { ride_id: String(ride.id), status: ride.status, ride });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/:id/reject",
  authRequired,
  roleRequired("driver"),
  validateParams(rideIdParamSchema),
  (req, res, next) => {
    try {
      const ride = rejectRide(req.params.id, req.user.id, { io: req.app.locals.io });
      return sendSuccess(res, { ride });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/:id/start",
  authRequired,
  roleRequired("driver"),
  validateParams(rideIdParamSchema),
  (req, res, next) => {
    try {
      const ride = startRide(req.params.id, req.user.id, { io: req.app.locals.io });
      return sendSuccess(res, { ride_id: String(ride.id), status: ride.status, ride });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/:id/request-payment",
  authRequired,
  roleRequired("driver"),
  validateParams(rideIdParamSchema),
  (req, res, next) => {
    try {
      const ride = requestRidePayment(req.params.id, req.user.id, {
        io: req.app.locals.io,
      });
      return sendSuccess(res, { ride });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/:id/complete",
  authRequired,
  roleRequired("driver"),
  validateParams(rideIdParamSchema),
  validateBody(completeRideBodySchema),
  (req, res, next) => {
    try {
      const ride = completeRide(req.params.id, req.user.id, { io: req.app.locals.io });
      return sendSuccess(res, { ride_id: String(ride.id), status: ride.status, ride });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
