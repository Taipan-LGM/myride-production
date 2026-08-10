# R*Tree Deployment Runbook

Spatial index for **nearby driver** queries on the legacy Node.js + SQLite stack.

## Actual schema mapping

Your spec may reference aspirational tables. **Production uses:**

| Aspirational / doc | Legacy SQLite (real) |
|--------------------|----------------------|
| `driver_id` | `driver_profiles.user_id` |
| `status = 'online'` | `online = 1` |
| `driver_locations_rtree` | `driver_profiles_rtree` |
| `users.full_name` | `users.name` |
| `vehicles` table | `driver_profiles.license_plate`, `vehicle_type` |
| `driver_tracks` | `driver_locations` (history) + live GPS on `driver_profiles` |

```
driver_profiles (lat, lng, online, updated_at)
       ↓ triggers
driver_profiles_rtree (user_id → bbox)
       ↓ pre-filter
GET /api/rides/nearby → Haversine refine + busy-driver exclude
```

## What gets created

| Object | Purpose |
|--------|---------|
| `driver_profiles_rtree` | SQLite RTREE virtual table (`id` = `user_id`) |
| `driver_profiles_rtree_upsert` | GPS / online / approval updates |
| `driver_profiles_rtree_remove` | Offline or unapproved |
| `driver_profiles_rtree_insert` | New online profile with GPS |
| `schema_migrations` | Tracks `003_driver_profiles_rtree` |

Applied on **API boot** (`database.js`) and via CLI scripts.

## Pre-deployment checklist

```sql
-- Online approved drivers with GPS
SELECT user_id, lat, lng, online, approval_status, updated_at
FROM driver_profiles
WHERE online = 1 AND approval_status = 'approved'
LIMIT 5;

-- Freshness (target < 30s for nearby API)
SELECT
  COUNT(*) AS total_online,
  SUM(CASE WHEN updated_at >= datetime('now', '-30 seconds') THEN 1 ELSE 0 END) AS fresh,
  ROUND(AVG((julianday('now') - julianday(updated_at)) * 86400)) AS avg_age_seconds
FROM driver_profiles
WHERE online = 1 AND lat IS NOT NULL;
```

## Backup

```bash
npm run backup:db
# or
./deploy-rtree.sh   # backs up automatically
```

## Deployment steps

### Option A — one command

```bash
cd "/home/taipan/Documents/My Ride"
chmod +x deploy-rtree.sh
./deploy-rtree.sh
```

### Option B — step by step

```bash
npm run migrate:rtree   # table + triggers
npm run seed:rtree      # populate from fresh online GPS
npm run verify:rtree    # health + query timing
npm run rtree:all       # all three
```

Expected verify output:

```
📌 R*Tree table:              ✅ EXISTS
📌 Triggers:                  ✅ (3)
📌 Fresh GPS (30s):           N
📌 R*Tree entries:            N
⚡ Nearby join query:         XXms ✅
✅ R*Tree is working correctly!
```

### Test API

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/rides/nearby?lat=-33.9249&lng=25.5701&radius=5000"
```

Requires **customer** JWT. Drivers must be `online = 1`, `approval_status = 'approved'`, GPS updated within **30 seconds**.

## Environment

```env
ENABLE_RTREE_INDEX=true      # set 0 to disable (bbox fallback still works)
ENABLE_NEARBY_DRIVERS=true
SQLITE_PATH=./mycab.sqlite   # or myride.sqlite on Render disk
```

## Troubleshooting

### R*Tree table missing

```bash
npm run migrate:rtree
# Check ENABLE_RTREE_INDEX is not 0
```

### R*Tree empty after seed

Normal if no drivers are online with GPS younger than 30s. Put a driver online via socket `driver:setOnline` and send `driver:updateLocation`.

```bash
npm run seed:rtree
```

### Count mismatch (fresh drivers vs R*Tree entries)

```bash
npm run seed:rtree
```

Triggers auto-update on `driver_profiles` changes; seed reconciles drift.

### Slow queries (> 500ms)

Check R*Tree size and `EXPLAIN QUERY PLAN` on nearby query. At NMB scale (<500 drivers) expect **< 50ms**.

### Feature-flag fallback

If RTREE is disabled or missing, `nearbyDriversService.js` uses lat/lng bounding box only (still correct, slightly slower at scale).

## Rollback

```sql
DROP TRIGGER IF EXISTS driver_profiles_rtree_upsert;
DROP TRIGGER IF EXISTS driver_profiles_rtree_remove;
DROP TRIGGER IF EXISTS driver_profiles_rtree_insert;
DROP TABLE IF EXISTS driver_profiles_rtree;
DELETE FROM schema_migrations WHERE name = '003_driver_profiles_rtree';
```

Or restore backup:

```bash
cp backups/mycab_YYYYMMDD_HHMMSS.sqlite mycab.sqlite
```

## Post-deployment validation

1. Driver goes online → `SELECT COUNT(*) FROM driver_profiles_rtree` increases  
2. Location update → bbox changes for that `user_id`  
3. Driver offline → row removed from RTREE  
4. `/api/rides/nearby` returns drivers within radius in < 200ms  

## Why not SpatiaLite?

Render + `better-sqlite3` does not ship `mod_spatialite`. Native SQLite RTREE is sufficient for Nelson Mandela Bay scale.

## Reference SQL

Canonical migration file: `backend/database/migrations/003_add_rtree_index.sql`
