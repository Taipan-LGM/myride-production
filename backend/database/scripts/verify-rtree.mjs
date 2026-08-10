#!/usr/bin/env node
/**
 * Verify driver_profiles_rtree health + nearby query performance.
 * Usage: node backend/database/scripts/verify-rtree.mjs
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { initDatabase } from "../../database.js";
import {
  migrateDriverProfilesRtree,
  verifyDriverProfilesRtree,
} from "../rtree.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../../..");
const schema = fs.readFileSync(path.join(root, "db", "schema.sql"), "utf8");

initDatabase(schema);
migrateDriverProfilesRtree();

const r = verifyDriverProfilesRtree();

console.log("\n🔍 Verifying R*Tree index...\n");
console.log(`📌 R*Tree table:              ${r.rtreeExists ? "✅ EXISTS" : "❌ MISSING"}`);
console.log(`📌 Triggers:                  ${r.triggersExist ? "✅" : "❌"} (${r.triggerNames?.length ?? 0})`);
if (r.triggerNames?.length) {
  for (const name of r.triggerNames) console.log(`   - ${name}`);
}
console.log(`📌 Online drivers (approved): ${r.onlineDrivers}`);
console.log(`📌 Fresh GPS (30s):           ${r.freshOnlineDrivers}`);
console.log(`📌 R*Tree entries:            ${r.rtreeEntries}`);

if (r.freshOnlineDrivers !== r.rtreeEntries && r.freshOnlineDrivers > 0) {
  console.warn(
    `⚠️  Mismatch: ${r.freshOnlineDrivers} fresh drivers vs ${r.rtreeEntries} R*Tree entries — run npm run seed:rtree`
  );
}

console.log(`\n⚡ R*Tree bbox query:         ${r.rtreePerformanceMs}ms ${r.rtreePerformanceMs < 200 ? "✅" : "⚠️"}`);
console.log(`⚡ Nearby join query:         ${r.nearbyPerformanceMs}ms ${(r.nearbyPerformanceMs ?? 999) < 200 ? "✅" : "⚠️"}`);
console.log(`📌 Nearby results:            ${r.nearbyCount}`);
if (r.nearestDistanceM != null) {
  console.log(`📌 Nearest driver:            ${r.nearestDistanceM}m`);
}
if (r.avgGpsAgeSeconds != null) {
  console.log(`📌 Avg GPS age (online):      ${r.avgGpsAgeSeconds}s`);
}

console.log("\n" + "═".repeat(60));
console.log("📊 VERIFICATION SUMMARY");
console.log("═".repeat(60));
console.log(`   Overall: ${r.ok ? "✅ R*Tree is working correctly!" : "⚠️  NEEDS ATTENTION"}`);
console.log("═".repeat(60));

process.exit(r.ok ? 0 : 1);
