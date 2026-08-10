import { z } from "zod";

export const paymentIntentBodySchema = z.object({
  ride_id: z.coerce.number().int().positive(),
  amount: z.coerce.number().min(0.01).optional(),
  currency: z.string().length(3).toUpperCase().optional(),
  payment_method: z.enum(["card", "cash", "wallet"]).optional().default("card"),
  save_card: z.boolean().optional().default(false),
});
/** Spec alias */
export const paymentIntentSchema = paymentIntentBodySchema;

export const createCheckoutBodySchema = z.object({
  ride_id: z.coerce.number().int().positive(),
});

export const capturePaymentBodySchema = z.object({
  payment_intent_id: z.string().trim().min(1),
  ride_id: z.coerce.number().int().positive(),
});
/** Spec alias */
export const capturePaymentSchema = capturePaymentBodySchema;

export const refundPaymentBodySchema = z
  .object({
    payment_id: z.coerce.number().int().positive().optional(),
    ride_id: z.coerce.number().int().positive().optional(),
    amount: z.coerce.number().min(0.01).optional(),
    reason: z.string().trim().max(255).optional(),
  })
  .refine((v) => v.ride_id != null || v.payment_id != null, {
    message: "ride_id or payment_id required",
    path: ["ride_id"],
  });
/** Spec alias */
export const refundPaymentSchema = refundPaymentBodySchema;

export const mockPayBodySchema = z.object({
  ride_id: z.coerce.number().int().positive(),
});

export const paymentHistoryQuerySchema = z.object({
  role: z.enum(["rider", "driver", "customer"]).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

export const cashPaymentBodySchema = z.object({
  ride_id: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive().optional(),
  amount_cents: z.coerce.number().int().positive().optional(),
});

export const withdrawalBodySchema = z.object({
  amount: z.coerce.number().min(1),
  method: z.enum(["bank_transfer", "mpesa", "cash_pickup"]),
  account_details: z.record(z.string(), z.unknown()).optional(),
});
/** Spec alias */
export const withdrawalSchema = withdrawalBodySchema;
