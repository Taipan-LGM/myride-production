import { ERROR_CODES, LEGACY_ACTION_CODE_MAP } from "./errorCodes.js";

export { ERROR_CODES, LEGACY_ACTION_CODE_MAP } from "./errorCodes.js";

/**
 * Base application error with structured JSON response.
 */
export class AppError extends Error {
  constructor(errorKey, details = null, messageOverride = null) {
    const errorDef = ERROR_CODES[errorKey] || ERROR_CODES.SVR_001;
    super(messageOverride || errorDef.message);
    this.name = "AppError";
    this.code = errorDef.code;
    this.status = errorDef.status;
    this.errorKey = errorDef === ERROR_CODES.SVR_001 && !ERROR_CODES[errorKey] ? "SVR_001" : errorKey;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }

  toJSON() {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
        timestamp: this.timestamp,
      },
    };
  }
}

export class ValidationError extends AppError {
  constructor(details) {
    super("VAL_001", details);
    this.name = "ValidationError";
    this.validationErrors = details;
  }

  toJSON() {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        details: this.validationErrors,
        timestamp: this.timestamp,
      },
    };
  }
}

export class NotFoundError extends AppError {
  constructor(resource, id) {
    super("RES_001", { resource, id });
    this.name = "NotFoundError";
    this.resource = resource;
    this.id = id;
  }
}

export class AuthError extends AppError {
  constructor(errorKey = "AUTH_001", details = null) {
    super(errorKey, details);
    this.name = "AuthError";
  }
}

export class PaymentError extends AppError {
  constructor(errorKey = "PAY_001", details = null, messageOverride = null) {
    super(errorKey, details, messageOverride);
    this.name = "PaymentError";
  }
}

export class RideError extends AppError {
  constructor(errorKey = "RIDE_001", details = null, messageOverride = null) {
    super(errorKey, details, messageOverride);
    this.name = "RideError";
  }
}

export class DriverError extends AppError {
  constructor(errorKey = "DRV_001", details = null, messageOverride = null) {
    super(errorKey, details, messageOverride);
    this.name = "DriverError";
  }
}

function isLegacyActionError(err) {
  return (
    err &&
    (err.name === "RideActionError" ||
      err.name === "DriverActionError" ||
      err.name === "PaymentActionError") &&
    typeof err.code === "string"
  );
}

/**
 * Normalize any thrown error into { status, body } for HTTP responses.
 */
export function resolveHttpError(err) {
  if (err instanceof AppError) {
    return { status: err.status, body: err.toJSON() };
  }

  if (isLegacyActionError(err)) {
    const mappedKey = LEGACY_ACTION_CODE_MAP[err.code];
    const def = mappedKey ? ERROR_CODES[mappedKey] : null;
    return {
      status: err.httpStatus || def?.status || 400,
      body: {
        success: false,
        error: {
          code: def?.code || err.code,
          message: err.message,
          legacy_code: err.code,
          timestamp: new Date().toISOString(),
        },
      },
    };
  }

  if (err?.name === "TokenExpiredError") {
    return {
      status: 401,
      body: {
        success: false,
        error: {
          code: ERROR_CODES.AUTH_003.code,
          message: ERROR_CODES.AUTH_003.message,
          timestamp: new Date().toISOString(),
        },
      },
    };
  }

  if (err?.name === "JsonWebTokenError") {
    return {
      status: 401,
      body: {
        success: false,
        error: {
          code: ERROR_CODES.AUTH_002.code,
          message: err.message || ERROR_CODES.AUTH_002.message,
          timestamp: new Date().toISOString(),
        },
      },
    };
  }

  if (err?.type === "StripeError" || err?.type === "StripeInvalidRequestError") {
    return {
      status: 502,
      body: {
        success: false,
        error: {
          code: ERROR_CODES.PAY_004.code,
          message: ERROR_CODES.PAY_004.message,
          details: process.env.NODE_ENV === "production" ? null : err.message,
          timestamp: new Date().toISOString(),
        },
      },
    };
  }

  if (err?.code && String(err.code).startsWith("SQLITE_")) {
    return {
      status: 500,
      body: {
        success: false,
        error: {
          code: ERROR_CODES.SVR_002.code,
          message: ERROR_CODES.SVR_002.message,
          timestamp: new Date().toISOString(),
        },
      },
    };
  }

  if (err?.status && err?.message) {
    return {
      status: Number(err.status) || 500,
      body: {
        success: false,
        error: {
          code: err.code || ERROR_CODES.SVR_001.code,
          message: err.message,
          timestamp: new Date().toISOString(),
        },
      },
    };
  }

  return {
    status: 500,
    body: {
      success: false,
      error: {
        code: ERROR_CODES.SVR_001.code,
        message:
          process.env.NODE_ENV === "production"
            ? ERROR_CODES.SVR_001.message
            : err?.message || ERROR_CODES.SVR_001.message,
        timestamp: new Date().toISOString(),
      },
    },
  };
}
