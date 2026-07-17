# Legacy My Ride (parent folder)

The git root `My Ride/` contains an older **Express + SQLite** demo that predates this ecosystem monorepo.

| Path | Stack | Notes |
|------|-------|-------|
| `../backend/` | Node.js Express | `server.js`, JWT, Socket.io |
| `../frontend/` | Static HTML/JS | Marketing + customer UI |
| `../mycab.sqlite` | SQLite | Legacy ride data |

**New work** belongs in `ecosystem/` (`my_ride_ecosystem`):

- `backend/` — Python FastAPI
- `frontend/` — Flutter
- `docs/` — This documentation set

Do not mix legacy Node routes with the new FastAPI backend unless explicitly migrating.
