/**
 * SQLite RTREE index for online driver_profiles (no Spatialite required).
 * Maps driver user_id → bounding box around last known lat/lng.
 */
import { db } from "../database.js";
import { getBoundingBox } from "../lib/geo.js";
import { logger } from "../lib/logger.js";

const RTREE_TABLE = "driver_profiles_rtree";
const LOCATION_BUFFER = 0.001; // ~100m
const GPS_FRESH_SECONDS = 30;

export function isRtreeEnabled() {
  if (process.env.ENABLE_RTREE_INDEX === "0") return false;
  return rtreeTableExists();
}

export function rtreeTableExists() {
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
    )
    .get(RTREE_TABLE);
  return Boolean(row);
}

function upsertDriverRtree(userId, lat, lng) {
  const buffer = LOCATION_BUFFER;
  db.prepare(
    `
    INSERT OR REPLACE INTO ${RTREE_TABLE} (id, min_lat, max_lat, min_lng, max_lng)
    VALUES (?, ?, ?, ?, ?)
  `
  ).run(userId, lat - buffer, lat + buffer, lng - buffer, lng + buffer);
}

function removeDriverRtree(userId) {
  db.prepare(`DELETE FROM ${RTREE_TABLE} WHERE id = ?`).run(userId);
}

/** Seed / refresh RTREE from all online approved drivers with GPS. */
export function seedDriverProfilesRtree() {
  if (!rtreeTableExists()) {
    return { seeded: 0, skipped: true, reason: "rtree_table_missing" };
  }

  db.exec(`DELETE FROM ${RTREE_TABLE}`);

  const rows = db
    .prepare(
      `
      SELECT user_id, lat, lng
      FROM driver_profiles
      WHERE online = 1
        AND approval_status = 'approved'
        AND lat IS NOT NULL
        AND lng IS NOT NULL
        AND updated_at >= datetime('now', '-${GPS_FRESH_SECONDS} seconds')
    `
    )
    .all();

  const insert = db.transaction((drivers) => {
    for (const d of drivers) {
      upsertDriverRtree(d.user_id, d.lat, d.lng);
    }
  });
  insert(rows);

  return { seeded: rows.length, skipped: false };
}

/** Create RTREE virtual table + triggers (idempotent). */
export function migrateDriverProfilesRtree() {
  if (process.env.ENABLE_RTREE_INDEX === "0") {
    logger.debug("RTREE migration skipped (ENABLE_RTREE_INDEX=0)");
    return { ok: false, skipped: true };
  }

  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS ${RTREE_TABLE}
      USING rtree(
        id,
        min_lat, max_lat,
        min_lng, max_lng
      );
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    const already = db
      .prepare("SELECT name FROM schema_migrations WHERE name = ?")
      .get("003_driver_profiles_rtree");

    db.exec("DROP TRIGGER IF EXISTS driver_profiles_rtree_upsert;");
    db.exec("DROP TRIGGER IF EXISTS driver_profiles_rtree_remove;");
    db.exec("DROP TRIGGER IF EXISTS driver_profiles_rtree_insert;");

    db.exec(`
      CREATE TRIGGER driver_profiles_rtree_upsert
      AFTER UPDATE OF lat, lng, online, approval_status ON driver_profiles
      WHEN NEW.online = 1
        AND NEW.approval_status = 'approved'
        AND NEW.lat IS NOT NULL
        AND NEW.lng IS NOT NULL
      BEGIN
        INSERT OR REPLACE INTO ${RTREE_TABLE} (id, min_lat, max_lat, min_lng, max_lng)
        VALUES (
          NEW.user_id,
          NEW.lat - ${LOCATION_BUFFER},
          NEW.lat + ${LOCATION_BUFFER},
          NEW.lng - ${LOCATION_BUFFER},
          NEW.lng + ${LOCATION_BUFFER}
        );
      END;
    `);

    db.exec(`
      CREATE TRIGGER driver_profiles_rtree_remove
      AFTER UPDATE OF online, approval_status ON driver_profiles
      WHEN NEW.online = 0 OR NEW.approval_status != 'approved'
      BEGIN
        DELETE FROM ${RTREE_TABLE} WHERE id = NEW.user_id;
      END;
    `);

    db.exec(`
      CREATE TRIGGER driver_profiles_rtree_insert
      AFTER INSERT ON driver_profiles
      WHEN NEW.online = 1
        AND NEW.approval_status = 'approved'
        AND NEW.lat IS NOT NULL
        AND NEW.lng IS NOT NULL
      BEGIN
        INSERT OR REPLACE INTO ${RTREE_TABLE} (id, min_lat, max_lat, min_lng, max_lng)
        VALUES (
          NEW.user_id,
          NEW.lat - ${LOCATION_BUFFER},
          NEW.lat + ${LOCATION_BUFFER},
          NEW.lng - ${LOCATION_BUFFER},
          NEW.lng + ${LOCATION_BUFFER}
        );
      END;
    `);

    if (!already) {
      db.prepare(
        "INSERT INTO schema_migrations (name) VALUES (?)"
      ).run("003_driver_profiles_rtree");
    }

    const seed = seedDriverProfilesRtree();
    logger.info("RTREE migration applied", seed);
    return { ok: true, ...seed };
  } catch (err) {
    logger.warn("RTREE migration failed (non-fatal, using bbox fallback)", err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Candidate driver user_ids inside RTREE bounding box (pre-filter).
 * @returns {number[] | null} null if RTREE unavailable
 */
export function rtreeCandidateUserIds(lat, lng, radiusM) {
  if (!isRtreeEnabled()) return null;

  const bbox = getBoundingBox(lat, lng, radiusM);
  const rows = db
    .prepare(
      `
      SELECT id AS user_id
      FROM ${RTREE_TABLE}
      WHERE min_lat <= ?
        AND max_lat >= ?
        AND min_lng <= ?
        AND max_lng >= ?
    `
    )
    .all(bbox.maxLat, bbox.minLat, bbox.maxLon, bbox.minLon);

  return rows.map((r) => r.user_id);
}

export function verifyDriverProfilesRtree() {
  const result = {
    rtreeExists: rtreeTableExists(),
    triggersExist: false,
    triggerNames: [],
    onlineDrivers: 0,
    freshOnlineDrivers: 0,
    rtreeEntries: 0,
    rtreePerformanceMs: null,
    nearbyPerformanceMs: null,
    nearbyCount: 0,
    nearestDistanceM: null,
    avgGpsAgeSeconds: null,
    ok: false,
  };

  if (!result.rtreeExists) return result;

  const triggers = db
    .prepare(
      `
      SELECT name FROM sqlite_master
      WHERE type = 'trigger'
        AND name LIKE '%driver_profiles_rtree%'
    `
    )
    .all();
  result.triggerNames = triggers.map((t) => t.name);
  result.triggersExist = triggers.length >= 2;

  result.onlineDrivers = db
    .prepare(
      `
      SELECT COUNT(*) AS c FROM driver_profiles
      WHERE online = 1 AND approval_status = 'approved'
        AND lat IS NOT NULL AND lng IS NOT NULL
    `
    )
    .get().c;

  result.freshOnlineDrivers = db
    .prepare(
      `
      SELECT COUNT(*) AS c FROM driver_profiles
      WHERE online = 1 AND approval_status = 'approved'
        AND lat IS NOT NULL AND lng IS NOT NULL
        AND updated_at >= datetime('now', '-${GPS_FRESH_SECONDS} seconds')
    `
    )
    .get().c;

  result.rtreeEntries = db
    .prepare(`SELECT COUNT(*) AS c FROM ${RTREE_TABLE}`)
    .get().c;

  const ageRow = db
    .prepare(
      `
      SELECT AVG(
        (julianday('now') - julianday(updated_at)) * 86400
      ) AS avg_seconds
      FROM driver_profiles
      WHERE online = 1 AND lat IS NOT NULL AND lng IS NOT NULL
    `
    )
    .get();
  result.avgGpsAgeSeconds =
    ageRow?.avg_seconds != null ? Math.round(ageRow.avg_seconds) : null;

  const testLat = -33.9249;
  const testLng = 25.5701;
  const bbox = getBoundingBox(testLat, testLng, 5000);
  const start = Date.now();
  db.prepare(
    `
    SELECT id FROM ${RTREE_TABLE}
    WHERE min_lat <= ? AND max_lat >= ?
      AND min_lng <= ? AND max_lng >= ?
    LIMIT 50
  `
  ).all(bbox.maxLat, bbox.minLat, bbox.maxLon, bbox.minLon);
  result.rtreePerformanceMs = Date.now() - start;

  const nearbyStart = Date.now();
  const nearbyRows = db
    .prepare(
      `
      SELECT
        dp.user_id,
        dp.lat,
        dp.lng,
        (6371000 * acos(
          MIN(1, MAX(-1,
            cos(radians(?)) * cos(radians(dp.lat)) *
            cos(radians(dp.lng) - radians(?)) +
            sin(radians(?)) * sin(radians(dp.lat))
          ))
        )) AS distance_meters
      FROM driver_profiles dp
      JOIN users u ON u.id = dp.user_id
      WHERE dp.online = 1
        AND dp.approval_status = 'approved'
        AND dp.lat IS NOT NULL
        AND dp.lng IS NOT NULL
        AND dp.updated_at >= datetime('now', '-${GPS_FRESH_SECONDS} seconds')
        AND dp.user_id IN (
          SELECT id FROM ${RTREE_TABLE}
          WHERE min_lat <= ? AND max_lat >= ?
            AND min_lng <= ? AND max_lng >= ?
        )
      ORDER BY distance_meters ASC
      LIMIT 20
    `
    )
    .all(
      testLat,
      testLng,
      testLat,
      bbox.maxLat,
      bbox.minLat,
      bbox.maxLon,
      bbox.minLon
    );
  result.nearbyPerformanceMs = Date.now() - nearbyStart;
  result.nearbyCount = nearbyRows.length;
  result.nearestDistanceM =
    nearbyRows[0]?.distance_meters != null
      ? Math.round(nearbyRows[0].distance_meters)
      : null;

  result.ok =
    result.triggersExist &&
    result.rtreePerformanceMs < 500 &&
    (result.nearbyPerformanceMs ?? 0) < 500;

  return result;
}
