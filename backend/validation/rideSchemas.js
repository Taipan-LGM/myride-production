import { z } from "zod";
import {
  isValidRideType,
  mapVehicleType,
  mapVehicleTypeForRide,
} from "../utils/vehicleTypes.js";

const vehicleTypeInput = z
  .string()
  .refine((val) => isValidRideType(val), {
    message:
      "Vehicle type must be one of: standard, premium, xl, bike, Car, MPV, Bike",
  })
  .transform((val) => mapVehicleType(val));

const coord = z.coerce.number().finite();

export const nearbyDriversQuerySchema = z.object({
  lat: coord.min(-90).max(90),
  lng: coord.min(-180).max(180),
  radius: z.coerce.number().finite().min(100).max(20_000).optional().default(5000),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  vehicle_type: vehicleTypeInput.optional(),
});

/** Spec alias */
export const nearbyDriversSchema = nearbyDriversQuerySchema;

export const createRideBodySchema = z
  .object({
    pickup_text: z.string().trim().min(3).max(120).optional(),
    pickup_address: z.string().trim().min(3).max(255).optional(),
    pickup_lat: coord.min(-90).max(90),
    pickup_lng: coord.min(-180).max(180),
    pickup_street_number: z.string().trim().max(20).optional(),
    pickup_route: z.string().trim().max(120).optional(),
    dropoff_text: z.string().trim().min(3).max(120).optional(),
    dropoff_address: z.string().trim().min(3).max(255).optional(),
    dropoff_lat: coord.min(-90).max(90),
    dropoff_lng: coord.min(-180).max(180),
    dropoff_street_number: z.string().trim().max(20).optional(),
    dropoff_route: z.string().trim().max(120).optional(),
    vehicle_type: vehicleTypeInput.optional().default("standard"),
    payment_method: z.enum(["cash", "card", "wallet"]).optional().default("cash"),
    estimated_fare: z.coerce.number().min(0).optional(),
    promo_code: z.string().trim().max(50).optional(),
  })
  .transform((data) => ({
    ...data,
    pickup_text: data.pickup_text || data.pickup_address || "",
    dropoff_text: data.dropoff_text || data.dropoff_address || "",
    vehicle_type: mapVehicleTypeForRide(data.vehicle_type),
    payment_method: data.payment_method === "wallet" ? "card" : data.payment_method,
  }))
  .refine((d) => d.pickup_text.length >= 3, {
    message: "Pickup address is required",
    path: ["pickup_text"],
  })
  .refine((d) => d.dropoff_text.length >= 3, {
    message: "Dropoff address is required",
    path: ["dropoff_text"],
  });

/** Spec alias */
export const createRideSchema = createRideBodySchema;

export const cancelRideBodySchema = z.object({
  reason: z.string().trim().max(255).optional().default("User cancelled"),
});
export const cancelRideSchema = cancelRideBodySchema;

export const rateRideBodySchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  feedback: z.string().trim().max(500).optional(),
});
export const rateRideSchema = rateRideBodySchema;

export const completeRideBodySchema = z.object({
  final_fare_cents: z.coerce.number().int().min(0).optional(),
  final_fare: z.coerce.number().min(0).optional(),
  actual_distance: z.coerce.number().int().min(0).optional(),
  actual_duration: z.coerce.number().int().min(0).optional(),
});
export const completeRideSchema = completeRideBodySchema;

export const rideHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

export const rideIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});
