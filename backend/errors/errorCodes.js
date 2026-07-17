// ============================================================
// ERROR CODES (legacy Node API)
// ============================================================

export const ERROR_CODES = {
  // Authentication (1000-1099)
  AUTH_001: { code: "AUTH_001", message: "Authentication required", status: 401 },
  AUTH_002: { code: "AUTH_002", message: "Invalid token", status: 401 },
  AUTH_003: { code: "AUTH_003", message: "Token expired", status: 401 },
  AUTH_004: { code: "AUTH_004", message: "Invalid credentials", status: 401 },
  AUTH_005: { code: "AUTH_005", message: "Account deactivated", status: 403 },
  AUTH_006: { code: "AUTH_006", message: "Insufficient permissions", status: 403 },

  // Validation (2000-2099)
  VAL_001: { code: "VAL_001", message: "Validation failed", status: 400 },
  VAL_002: { code: "VAL_002", message: "Invalid latitude", status: 400 },
  VAL_003: { code: "VAL_003", message: "Invalid longitude", status: 400 },
  VAL_004: { code: "VAL_004", message: "Invalid radius", status: 400 },
  VAL_005: { code: "VAL_005", message: "Invalid vehicle type", status: 400 },
  VAL_006: { code: "VAL_006", message: "Invalid payment method", status: 400 },
  VAL_007: { code: "VAL_007", message: "Invalid rating value", status: 400 },
  VAL_008: { code: "VAL_008", message: "Missing required field", status: 400 },

  // Resource (3000-3099)
  RES_001: { code: "RES_001", message: "Resource not found", status: 404 },
  RES_002: { code: "RES_002", message: "Ride not found", status: 404 },
  RES_003: { code: "RES_003", message: "Driver not found", status: 404 },
  RES_004: { code: "RES_004", message: "Customer not found", status: 404 },
  RES_005: { code: "RES_005", message: "Vehicle not found", status: 404 },

  // Ride (4000-4099)
  RIDE_001: { code: "RIDE_001", message: "Active ride exists", status: 400 },
  RIDE_002: { code: "RIDE_002", message: "Ride not available", status: 400 },
  RIDE_003: { code: "RIDE_003", message: "Ride already completed", status: 400 },
  RIDE_004: { code: "RIDE_004", message: "Cannot cancel completed ride", status: 400 },
  RIDE_005: { code: "RIDE_005", message: "No drivers available", status: 404 },
  RIDE_006: { code: "RIDE_006", message: "Driver not assigned", status: 400 },
  RIDE_007: { code: "RIDE_007", message: "Invalid ride status transition", status: 400 },
  RIDE_008: { code: "RIDE_008", message: "Unauthorized to modify ride", status: 403 },

  // Driver (5000-5099)
  DRV_001: { code: "DRV_001", message: "Driver not available", status: 400 },
  DRV_002: { code: "DRV_002", message: "Driver already assigned", status: 400 },
  DRV_003: { code: "DRV_003", message: "Driver application pending", status: 400 },
  DRV_004: { code: "DRV_004", message: "Driver not verified", status: 403 },
  DRV_005: { code: "DRV_005", message: "Driver offline", status: 400 },
  DRV_006: { code: "DRV_006", message: "Vehicle not approved", status: 400 },

  // Payment (6000-6099)
  PAY_001: { code: "PAY_001", message: "Payment failed", status: 400 },
  PAY_002: { code: "PAY_002", message: "Insufficient balance", status: 400 },
  PAY_003: { code: "PAY_003", message: "Invalid payment method", status: 400 },
  PAY_004: { code: "PAY_004", message: "Stripe error", status: 502 },
  PAY_005: { code: "PAY_005", message: "Payment not found", status: 404 },
  PAY_006: { code: "PAY_006", message: "Refund failed", status: 400 },
  PAY_007: { code: "PAY_007", message: "Wallet not found", status: 404 },

  // Location (7000-7099)
  LOC_001: { code: "LOC_001", message: "GPS location not available", status: 400 },
  LOC_002: { code: "LOC_002", message: "Stale location data", status: 400 },

  // Server (9000-9999)
  SVR_001: { code: "SVR_001", message: "Internal server error", status: 500 },
  SVR_002: { code: "SVR_002", message: "Database error", status: 500 },
  SVR_003: { code: "SVR_003", message: "Service unavailable", status: 503 },
};

/** Map legacy action error codes → structured ERROR_CODES keys. */
export const LEGACY_ACTION_CODE_MAP = {
  not_found: "RES_002",
  ride_not_found: "RES_002",
  invalid_ride_id: "VAL_008",
  invalid_input: "VAL_001",
  invalid_coordinates: "LOC_001",
  active_ride_exists: "RIDE_001",
  not_assigned_to_you: "RIDE_008",
  forbidden: "RIDE_008",
  invalid_status_transition: "RIDE_007",
  cannot_cancel_completed: "RIDE_004",
  driver_not_approved: "DRV_004",
  driver_offline: "DRV_005",
  driver_application_pending: "DRV_003",
  payment_not_required_yet: "PAY_001",
  payment_init_failed: "PAY_001",
  stripe_not_configured: "SVR_003",
  invalid_amount: "PAY_003",
};
