import helmet from "helmet";

/**
 * Helmet defaults + CSP tuned for this SPA (same-origin scripts/modules, inline styles in HTML,
 * Socket.io, Stripe Checkout / hosted flows, media capture for QR).
 *
 * Set HELMET_DISABLE_CSP=1 to turn off CSP only (other Helmet middleware stays on).
 */
export function securityHeadersMiddleware(nodeEnv) {
  const disableCsp =
    nodeEnv !== "production" || process.env.HELMET_DISABLE_CSP === "1";

  if (disableCsp) {
    return helmet({ contentSecurityPolicy: false });
  }

  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://unpkg.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
        imgSrc: [
          "'self'",
          "data:",
          "blob:",
          "https://*.tile.openstreetmap.org",
        ],
        fontSrc: ["'self'"],
        connectSrc: [
          "'self'",
          "https://router.project-osrm.org",
          "https://api.stripe.com",
          "https://merchant-ui-api.stripe.com",
          "https://checkout.stripe.com",
          "https://js.stripe.com",
          "https://q.stripe.com",
          "https://r.stripe.com",
        ],
        frameSrc: [
          "'self'",
          "https://js.stripe.com",
          "https://hooks.stripe.com",
          "https://checkout.stripe.com",
        ],
        mediaSrc: ["'self'", "blob:"],
        workerSrc: ["'self'", "blob:"],
        baseUri: ["'self'"],
        formAction: ["'self'", "https://checkout.stripe.com"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false,
  });
}
