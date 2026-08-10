# My Ride — Backend Implementation Tickets (v1)

**Stack:** Legacy Node.js + Express + Socket.io + SQLite (`better-sqlite3`) on Render  
**Market:** Nelson Mandela Bay, ZA  
**Last reconciled:** 2026-07-13 (against `db/schema.sql` + `backend/`)

This document supersedes aspirational tickets that reference `driver_tracks`, `drivers.status`, SpatiaLite, or Redis on Render. Those do **not** exist in v1 production.

---

## Ticket summary (authoritative)

| ID | Ticket | Priority | Est. | Dependencies | Status |
|----|--------|----------|------|--------------|--------|
| **P0-000** | `POST /api/rides/:id/cancel` | Critical | 3h | None | **Done** |
| **P0-001** | `GET /api/rides/nearby` | Critical | 2–3h | **None** | **Done** |
| **P0-002** | Socket.io events (subset) | Critical | 4h | Existing Socket.io | **Done** |
| **INF-001** | SQLite performance indexes | Critical | 30m | None | **Done** |
| ~~P0-003~~ | Geo-spatial (SpatiaLite/rtree) | — | — | — | **Deferred** → PostGIS on Postgres |
| **P1-004** | Wallet endpoints | High | 1–5h | Zoneless confirmation | Blocked |
| **P2-005** | Chat (Node) | Low | — | — | **Use FastAPI** in `ecosystem/` |
| **P2-006** | Redis caching | Medium | — | Redis infra | Future |
| **P2-007** | Per-route rate limits | Medium | 1–2h | None | Future |

### Dependency graph (corrected)

```text
INF-001 (indexes) ──┬──► P0-001 (nearby)     [parallel OK]
                    └──► P0-002 (sockets)    [parallel OK]

P0-000 (cancel)     ── independent

P0-001 does NOT require P0-003 or INF-001 to ship (indexes are a quick win, not a blocker).

P1-004 ── blocked until Zoneless ops decision

P2-005 ── defer (FastAPI chat already exists)
```

---

## Legacy schema reference (use these names)

| Ticket says | Actual SQLite |
|-------------|---------------|
| `driver_tracks` | `driver_locations` (history) + live `lat`/`lng` on `driver_profiles` |
| `drivers` table | `users` (role=`driver`) + `driver_profiles` |
| `drivers.status = 'online'` | `driver_profiles.online = 1` |
| `rider` role | `customer` |
| `last_updated` on tracks | `driver_profiles.updated_at` |
| Ratings | **No table** — omit or return `null` |

---

## P0-000: `POST /api/rides/:id/cancel`

**Launch blocker** (missing from original backlog; required by Flutter tracking screen).

| Field | Value |
|-------|-------|
| Path | `POST /api/rides/:id/cancel` |
| Auth | JWT; `customer` (own ride) or `driver` (assigned ride) |
| Body | `{ reason?: string }` |
| Logic | Set `status='cancelled'` if not `completed`; emit `ride:updated` + `ride:cancelled` |
| Card rides | Optionally set `payment_status` / Stripe cancel if hold exists |

**Location:** `backend/routes/rides.js`

---

## P0-001: `GET /api/rides/nearby`

| Field | Value |
|-------|-------|
| Path | `GET /api/rides/nearby` |
| Auth | JWT + `roleRequired("customer")` |
| Query | `lat`, `lng` (required); `radius` default **5000** (meters); `vehicle_type` optional (`Car`/`MPV`); `limit` default 20, max 50 |

### Implementation (legacy-accurate)

1. Extract `pickNearestDriver` / `haversineMeters` from `rides.js` → `backend/services/nearbyDriversService.js`.
2. Query `driver_profiles` JOIN `users`:
   - `approval_status='approved'`, `online=1`, lat/lng NOT NULL
   - Optional `vehicle_type` filter
   - `updated_at` within last **30s** (freshness)
3. Exclude busy drivers: active ride `status IN ('matched','accepted','arriving','in_progress')`.
4. Haversine distance; filter `distance <= radius`; sort ASC; limit.
5. **No Redis** on Render v1.

### Response shape (honest for v1)

```json
{
  "success": true,
  "data": {
    "drivers": [{
      "driver_id": "12",
      "user_id": "12",
      "name": "Thabo M.",
      "vehicle": {
        "plate_number": "CA 123-456",
        "vehicle_type": "Car"
      },
      "location": {
        "lat": -33.96,
        "lng": 25.60,
        "last_updated": "2026-07-13T15:00:00.000Z"
      },
      "distance": 842,
      "rating": null,
      "is_available": true
    }],
    "total": 1,
    "query_radius": 5000
  }
}
```

Fields `make`, `model`, `color`, `bearing`, `speed` → **omit or null** (not in DB).

### Feature flag

`ENABLE_NEARBY_DRIVERS=0` → return `{ success: true, data: { drivers: [], total: 0, query_radius } }`.

### Tests

- Haversine unit test
- Integration: drivers inside/outside radius
- Empty area → `drivers: []`
- Invalid lat/lng → 400

**Location:** `backend/routes/rides.js`, `backend/services/nearbyDriversService.js`

---

## P0-002: Socket.io events (v1 subset)

**Location:** `backend/server.js` (no `backend/socket/index.js` today). Optionally extract to `backend/socket/index.js` later.

### Already implemented

| Event | Direction |
|-------|-----------|
| `hello` | Server → client |
| `driver:setOnline` | Client → server |
| `driver:updateLocation` | Client → server |
| `driver:onlineStatus`, `driver:shiftSummary` | Server → driver |
| `ride:request` | Server → driver (on match) |
| `ride:updated` | Server → customer/driver/admin |

Socket JWT auth: `socketAuthMiddleware` in `auth.js` ✓

### Add in v1

| Event | When | Target |
|-------|------|--------|
| `ride:incoming` | Same as `ride:request` | Driver — **alias emit** for Flutter contract |
| `ride:matched` | On `POST /api/rides/` when `status=matched` | `customer:{id}` |
| `driver:location_update` | On `driver:updateLocation` if driver has active ride | `customer:{customer_id}` + `ride:{ride_id}` |
| `ride:cancelled` | On P0-000 cancel | Both parties |

### Ride rooms

```text
On accept: socket.join(`ride:${rideId}`) for driver + customer
On complete/cancel: leave room
```

### Defer v1

- `ride:eta_update` (client-side ETA or OSRM later)
- Chat socket events (P2-005 / FastAPI)
- Custom heartbeat (Socket.io built-in ping/pong)
- 1000-connection load test on starter plan

### Feature flag

`ENABLE_SOCKET_EVENTS=0` → Flutter falls back to `GET /api/rides/:id` polling.

### Throttle

Server-side: max 1 `driver:updateLocation` processed per driver per **2s**.

---

## INF-001: SQLite indexes (replaces P0-003 for v1)

**Do not install SpatiaLite on Render** — fragile with `better-sqlite3`.

Add in `backend/database.js` migrate() or `db/schema.sql`:

```sql
CREATE INDEX IF NOT EXISTS idx_dp_online_loc
  ON driver_profiles(online, lat, lng)
  WHERE online = 1;

CREATE INDEX IF NOT EXISTS idx_rides_driver_status
  ON rides(driver_id, status);

CREATE INDEX IF NOT EXISTS idx_rides_customer_status
  ON rides(customer_id, status);

CREATE INDEX IF NOT EXISTS idx_driver_locations_driver_time
  ON driver_locations(driver_user_id, created_at DESC);
```

**P0-003 PostGIS:** document in `POSTGRES_MIGRATION.md`; apply after Track A cutover.

---

## P1-004: Wallet endpoints (blocked)

**Prerequisite:** Confirm with ops — Zoneless active? Driver self-withdraw or admin batch?

### v1 minimal (if unblocked, Option A)

| Endpoint | Implementation |
|----------|----------------|
| `GET /api/payments/wallet` | Map `driver_profiles.earnings_cents` → ZAR; `available` = earnings; `pending` = sum unpaid completed rides |

Withdraw: **admin-only** today via `POST /api/payouts/payout-driver`. Driver self-withdraw = Option B (+4h, Zoneless).

---

## P2-005: Chat

**Decision:** Keep chat on **FastAPI** (`ecosystem/backend`) for v1 hybrid architecture. Do not duplicate in Node during launch week.

---

## P2-006: Redis

**Not on Render blueprint.** Use in-process TTL cache for `nearby` if needed later. Add Redis when multi-instance or Postgres tier exists.

---

## P2-007: Rate limiting

**Partially exists:** global 180/min, auth 40/15min, geocode limiter.

Add without Redis:

- `GET /api/rides/nearby` → 60/min per IP
- `POST /api/rides/` → 30/min per user
- Socket location throttle (see P0-002)

---

## Week 1 roadmap (corrected)

| Day | Work |
|-----|------|
| 1 | INF-001 indexes + P0-000 cancel |
| 2 | P0-001 nearby endpoint + tests |
| 3–4 | P0-002 socket aliases, ride rooms, `driver:location_update` |
| 5 | Integration: Flutter rider home + tracking against legacy API |
| 6–7 | Buffer / deploy Render |

---

## Validation checklist (this codebase)

| Requirement | Use |
|-------------|-----|
| Input validation | **Zod** (not Joi) |
| Logging | **morgan** + `console` structured lines |
| Auth role | `customer` not `rider` |
| OpenAPI | Nice-to-have post-P0 |
| Coverage | Target critical paths (nearby, cancel, socket helpers) |

---

## Open questions

| Question | Blocks |
|----------|--------|
| Zoneless active for driver self-payout? | P1-004 full scope |
| CartTrack required? | Fare distance only |
| LogicLine QR in production? | Driver login flow |

---

## Related docs

- `ecosystem/docs/LEGACY.md` — do not mix FastAPI into legacy routes without adapter
- Documents 4–5 — API + screen contracts (Flutter target names)
- Document 7 — Postgres migration (Track A lift-and-shift first)
