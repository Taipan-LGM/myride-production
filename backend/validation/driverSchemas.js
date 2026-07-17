import { z } from "zod";
import {
  getVehicleTypeAliases,
  mapVehicleType,
} from "../utils/vehicleTypes.js";

const coord = z.coerce.number().finite();

/**
 * Status update — legacy uses online=0|1; also accepts status/is_online aliases.
 */
export const driverStatusBodySchema = z
  .object({
    online: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
    status: z.enum(["online", "offline"]).optional(),
    is_online: z.boolean().optional(),
    lat: coord.min(-90).max(90).optional(),
    lng: coord.min(-180).max(180).optional(),
    location: z
      .object({
        lat: coord.min(-90).max(90),
        lng: coord.min(-180).max(180),
      })
      .optional(),
  })
  .refine(
    (v) =>
      v.online !== undefined ||
      v.status !== undefined ||
      v.is_online !== undefined,
    { message: "online, status, or is_online required" }
  );

/** Spec alias */
export const driverStatusSchema = driverStatusBodySchema;

export const driverLocationBodySchema = z
  .object({
    lat: coord.min(-90).max(90).optional(),
    lng: coord.min(-180).max(180).optional(),
    latitude: coord.min(-90).max(90).optional(),
    longitude: coord.min(-180).max(180).optional(),
    bearing: z.coerce.number().finite().min(0).max(360).optional(),
    speed: z.coerce.number().finite().min(0).max(300).optional(),
    accuracy: z.coerce.number().finite().min(0).optional(),
    online: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
    status: z.enum(["online", "offline"]).optional(),
    is_online: z.boolean().optional(),
    location: z
      .object({
        lat: coord.min(-90).max(90),
        lng: coord.min(-180).max(180),
      })
      .optional(),
  })
  .refine(
    (v) =>
      (v.lat != null && v.lng != null) ||
      (v.latitude != null && v.longitude != null) ||
      v.location != null,
    { message: "lat/lng or location object required" }
  );

/** Spec alias */
export const driverLocationSchema = driverLocationBodySchema;

export const driverEarningsQuerySchema = z.object({
  period: z.enum(["today", "week", "month"]).optional().default("today"),
});

export const driverHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

const digitsExact = (len) =>
  z
    .string()
    .trim()
    .regex(new RegExp(`^\\d{${len}}$`), `Must be exactly ${len} digits`);

/** Legacy public driver application form fields. */
export const driverApplicationBodySchema = z.object({
  applicant_name: z.string().trim().min(2).max(60),
  applicant_surname: z.string().trim().min(2).max(60),
  id_number: digitsExact(13),
  contact_number: digitsExact(10),
  address: z.string().trim().min(5).max(120),
  suburb: z.string().trim().min(2).max(80),
  city: z.string().trim().min(2).max(80),
  postal_code: digitsExact(6),
  driving_experience_years: z.coerce.number().int().min(0).max(80).optional(),
  years_experience: z.coerce.number().int().min(0).max(50).optional(),
  driver_license: z.string().trim().min(5).max(50).optional(),
  id_document_ref: z.string().trim().max(300).optional(),
  license_pdp_ref: z.string().trim().max(300).optional(),
  comments: z.string().trim().max(600).optional(),
  vehicle_make: z.string().trim().max(50).optional(),
  vehicle_model: z.string().trim().max(50).optional(),
  vehicle_license_plate: z.string().trim().max(20).optional(),
  vehicle_color: z.string().trim().max(30).optional(),
  vehicle_type: z
    .string()
    .refine((val) => getVehicleTypeAliases().includes(val), {
      message: "Invalid vehicle type",
    })
    .transform((val) => mapVehicleType(val))
    .optional(),
});

/** Spec alias */
export const driverApplicationSchema = driverApplicationBodySchema;
