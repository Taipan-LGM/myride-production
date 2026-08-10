-- ============================================================
-- MIGRATION: 003_add_rtree_index.sql
-- R*Tree spatial index for nearby driver queries
--
-- ACTUAL SCHEMA (legacy SQLite — not aspirational Doc 7):
--   driver_profiles.user_id  → PK (NOT driver_id)
--   driver_profiles.online   → 0|1 (NOT status = 'online')
--   driver_profiles.lat/lng/updated_at → live GPS
--   driver_locations         → history (optional, not indexed)
--
-- Virtual table: driver_profiles_rtree (id = user_id)
-- Applied on boot via backend/database/rtree.js (better-sqlite3).
-- ============================================================

BEGIN TRANSACTION;

-- Native SQLite RTREE (no SpatiaLite extension)
DROP TABLE IF EXISTS driver_profiles_rtree;

CREATE VIRTUAL TABLE driver_profiles_rtree
USING rtree(
  id,           -- driver_profiles.user_id
  min_lat, max_lat,
  min_lng, max_lng
);

-- Upsert when GPS / online / approval changes
DROP TRIGGER IF EXISTS driver_profiles_rtree_upsert;
CREATE TRIGGER driver_profiles_rtree_upsert
AFTER UPDATE OF lat, lng, online, approval_status ON driver_profiles
WHEN NEW.online = 1
  AND NEW.approval_status = 'approved'
  AND NEW.lat IS NOT NULL
  AND NEW.lng IS NOT NULL
  AND (NEW.lat != OLD.lat OR NEW.lng != OLD.lng OR NEW.online != OLD.online)
BEGIN
  INSERT OR REPLACE INTO driver_profiles_rtree (id, min_lat, max_lat, min_lng, max_lng)
  VALUES (
    NEW.user_id,
    NEW.lat - 0.001,
    NEW.lat + 0.001,
    NEW.lng - 0.001,
    NEW.lng + 0.001
  );
END;

-- Remove when driver goes offline or unapproved
DROP TRIGGER IF EXISTS driver_profiles_rtree_remove;
CREATE TRIGGER driver_profiles_rtree_remove
AFTER UPDATE OF online, approval_status ON driver_profiles
WHEN NEW.online = 0 OR NEW.approval_status != 'approved'
BEGIN
  DELETE FROM driver_profiles_rtree WHERE id = NEW.user_id;
END;

-- Insert when new approved online profile gets GPS
DROP TRIGGER IF EXISTS driver_profiles_rtree_insert;
CREATE TRIGGER driver_profiles_rtree_insert
AFTER INSERT ON driver_profiles
WHEN NEW.online = 1
  AND NEW.approval_status = 'approved'
  AND NEW.lat IS NOT NULL
  AND NEW.lng IS NOT NULL
BEGIN
  INSERT OR REPLACE INTO driver_profiles_rtree (id, min_lat, max_lat, min_lng, max_lng)
  VALUES (
    NEW.user_id,
    NEW.lat - 0.001,
    NEW.lat + 0.001,
    NEW.lng - 0.001,
    NEW.lng + 0.001
  );
END;

COMMIT;

-- Verify
SELECT 'R*Tree table' AS check_name, COUNT(*) AS ok
FROM sqlite_master WHERE type = 'table' AND name = 'driver_profiles_rtree';

SELECT 'R*Tree triggers' AS check_name, COUNT(*) AS count
FROM sqlite_master
WHERE type = 'trigger' AND name LIKE '%driver_profiles_rtree%';
