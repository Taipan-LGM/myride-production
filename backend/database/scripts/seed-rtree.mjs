#!/usr/bin/env node
/**
 * Seed driver_profiles_rtree from online drivers with fresh GPS (30s).
 * Usage: node backend/database/scripts/seed-rtree.mjs
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { initDatabase, db } from "../../database.js";
import {
  migrateDriverProfilesRtree,
  seedDriverProfilesRtree,
  rtreeTableExists,
} from "../rtree.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../../..");
const schema = fs.readFileSync(path.join(root, "db", "schema.sql"), "utf8");

initDatabase(schema);
migrateDriverProfilesRtree();

if (!rtreeTableExists()) {
  console.error("❌ driver_profiles_rtree missing. Run: npm run migrate:rtree");
  process.exit(1);
}

console.log("🌱 Seeding R*Tree from driver_profiles...\n");

const onlineCount = db
  .prepare(
    `
    SELECT COUNT(*) AS c FROM driver_profiles
    WHERE online = 1 AND approval_status = 'approved'
      AND lat IS NOT NULL AND lng IS NOT NULL
      AND updated_at >= datetime('now', '-30 seconds')
  `
  )
  .get().c;

console.log(`📊 Online drivers with fresh GPS (30s): ${onlineCount}`);

const result = seedDriverProfilesRtree();
const rtreeCount = db
  .prepare("SELECT COUNT(*) AS c FROM driver_profiles_rtree")
  .get().c;

console.log("\n📊 SEEDING SUMMARY");
console.log("═".repeat(50));
console.log(`   Fresh online drivers:  ${onlineCount}`);
console.log(`   Seeded into R*Tree:    ${result.seeded ?? 0}`);
console.log(`   R*Tree total entries:  ${rtreeCount}`);
console.log("═".repeat(50));

if (result.skipped) {
  console.warn("⚠️  Seeding skipped:", result.reason);
  process.exit(1);
}

if (onlineCount > 0 && result.seeded === 0) {
  console.warn("⚠️  Expected seeds but got 0 — check GPS freshness.");
}

console.log("✅ R*Tree seeding completed successfully!");
