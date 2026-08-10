import helmet from "helmet";

/**
 * Helmet defaults + CSP tuned for this SPA (same-origin scripts/modules, inline styles in HTML,
 * Socket.io, Stripe Checkout / hosted flows, media capture for QR).
 *
 * Set HELMET_DISABLE_CSP=1 to turn off CSP only (other Helmet middleware stays on).
 *
 * crossOriginResourcePolicy: cross-origin — required so Flutter web (other port/origin)
 * can read /api JSON. same-origin CORP breaks email register/login from localhost:876x.
 */
const sharedHelmetOpts = {
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
};

export function securityHeadersMiddleware(nodeEnv) {
  const disableCsp =
    nodeEnv !== "production" || process.env.HELMET_DISABLE_CSP === "1";

  if (disableCsp) {
    return helmet({
      contentSecurityPolicy: false,
      ...sharedHelmetOpts,
    });
  }

  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Stripe.js (Payment Element) loads from js.stripe.com — required for card payments in prod CSP.
        scriptSrc: ["'self'", "https://unpkg.com", "https://js.stripe.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
        imgSrc: [
          "'self'",
          "data:",
          "blob:",
          "https://*.tile.openstreetmap.org",
          "https://unpkg.com",
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
    ...sharedHelmetOpts,
  });
}
