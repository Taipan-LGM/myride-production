# Production operations

## Service ownership

The FastAPI ecosystem at `https://my-ride-ecosystem.onrender.com` is the production API for the web hub and Flutter clients. The legacy Node service duplicates those roles, is not referenced by the production Flutter configuration, and currently returns HTTP 503. Keep it out of new client configuration and retire it in the Render dashboard after exporting its SQLite disk if any historical data must be retained.

## Monitoring and alerts

The scheduled `Ecosystem health` GitHub Actions workflow checks every 15 minutes that:

- `/health` returns HTTP 200 and `status=ok`;
- PostgreSQL is primary and Redis is connected;
- HTTPS, CORS, JWT, production mode, and debug guards remain correct.

Enable GitHub Actions failure notifications for repository maintainers. Add a free UptimeRobot HTTPS monitor for `/health` at five-minute intervals when an owner is available to create the external account. Alert after two failures and send recovery notifications to the same channel.

Firebase Crashlytics is already integrated in the Flutter clients and activates only when valid Firebase configuration is supplied. Do not add Sentry unless a separate backend error inbox is required; avoiding duplicate telemetry reduces cost and privacy surface.

## Backup and restore

PostgreSQL is the source of truth. In Render, confirm automatic backups are enabled for `myride-pg`, record the retention window, and restrict database access to named operators. Before launch and monthly thereafter:

1. Create an on-demand backup in Render.
2. Restore it to a temporary database, never over production.
3. Run `ecosystem/backend/database/init.sql` against the restored database.
4. Verify ride and payment-ledger counts plus one known trip.
5. Delete the temporary database after recording the result.

Before retiring the legacy service, download its `/var/data/myride.sqlite` disk if retention is required. Redis is a cache and is not a backup target.

## Incident response

Severity:

- SEV-1: unsafe payment state, data loss, authentication bypass, or total outage.
- SEV-2: booking, dispatch, payout, or webhook degradation with a workaround.
- SEV-3: isolated channel, telemetry, or presentation defect.

Response:

1. Acknowledge the alert and name an incident lead.
2. Record start time, affected endpoints, release commit, and customer impact.
3. For payment incidents, disable provider webhooks or payment entry points before retrying operations.
4. Roll Render back to the previous healthy deploy when the current release is implicated.
5. Set `USE_POSTGRES_PRIMARY=false` only when the documented fallback store is known current.
6. Preserve logs and provider event IDs; never paste secrets into tickets or chat.
7. After recovery, reconcile payment ledger entries and publish a short post-incident review.

## Launch controls

- Keep paid integrations in mock/sandbox mode until the explicit go-live decision.
- Keep `ALLOW_PHASE0_SEED=false` in production.
- Disable demo accounts only after a production identity provider can issue FastAPI-compatible JWTs; the current FastAPI login route otherwise has no non-demo login path.
- Stripe Connect approval, Twilio sandbox enrollment, Cartrack test access, OpenAI credentials, UptimeRobot ownership, and Render backup settings require their respective account owners.

## Android release gate

Internal Rider and Driver APKs must be compiled with `API_BASE_URL=https://my-ride-ecosystem.onrender.com` and `LEGACY_BACKEND=false`. Before Play Store publication:

- replace the debug release signing configuration with an operator-owned upload keystore stored outside Git;
- assign distinct application IDs if Rider and Driver are distributed as separate apps;
- supply restricted Google Maps and Firebase Android configuration;
- clear the existing Flutter analyzer warnings and run device/emulator smoke tests for booking, location permissions, driver offers, and SOS.
