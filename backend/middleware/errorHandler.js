import { logger } from "../lib/logger.js";
import { resolveHttpError } from "../errors/index.js";

/**
 * Global Express error handler (register after API routes).
 */
export function errorHandler(err, req, res, _next) {
  const { status, body } = resolveHttpError(err);

  if (status >= 500) {
    logger.error("HTTP error", {
      message: err?.message,
      stack: err?.stack,
      path: req.path,
      method: req.method,
      userId: req.user?.id,
    });
  }

  if (res.headersSent) return;
  return res.status(status).json(body);
}

export default errorHandler;
