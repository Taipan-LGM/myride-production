# My Ride Ecosystem Docs

Central documentation for the **my_ride_ecosystem** monorepo (`ecosystem/`).

## Layout

```
my_ride_ecosystem/          # workspace: ecosystem/
├── backend/                # Python FastAPI — trips, AI, voice, payments
├── frontend/               # Flutter — Rider, Driver, Admin apps
└── docs/                   # This folder
```

## Guides

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | AI brain diagram, stack, roadmap |
| [BACKEND.md](./BACKEND.md) | FastAPI services, endpoints, env vars, run commands |
| [FRONTEND.md](./FRONTEND.md) | Flutter flavors, maps, Firebase, payments |
| [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) | Colors, typography, motion tokens |
| [LEGACY.md](./LEGACY.md) | Older `My Ride/` root app (Express + SQLite) |

## Quick start

```bash
# Backend API (port 8000)
cd backend && ./start_api.sh

# Admin OTP (port 8788, separate process)
cd backend && python3 admin_otp_server.py

# Flutter Rider app
cd frontend && flutter pub get && ./scripts/run_rider.sh
```

## Supporting assets (not core layout)

| Path | Purpose |
|------|---------|
| `design-system/` | JSON/CSS design tokens |
| `prototypes/` | HTML wireframes & live showcases |
| `react/` | Admin web stubs (future) |

## Product name

Official name: **My Ride** (not My Cab).
