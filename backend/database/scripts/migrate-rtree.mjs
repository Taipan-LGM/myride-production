#!/usr/bin/env node
/**
 * Apply R*Tree migration (driver_profiles_rtree + triggers).
 * Usage: node backend/database/scripts/migrate-rtree.mjs
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { initDatabase } from "../../database.js";
import { migrateDriverProfilesRtree, rtreeTableExists } from "../rtree.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../../..");
const schema = fs.readFileSync(path.join(root, "db", "schema.sql"), "utf8");

console.log("🚀 Starting R*Tree migration...\n");

initDatabase(schema);
const result = migrateDriverProfilesRtree();

if (!rtreeTableExists()) {
  console.error("❌ driver_profiles_rtree missing. Check ENABLE_RTREE_INDEX and logs.");
  process.exit(1);
}

const triggers = result.ok !== false ? "✅" : "⚠️";
console.log(`📌 R*Tree table: ✅ EXISTS`);
console.log(`📌 Migration:     ${triggers} ${JSON.stringify(result)}`);
console.log("\n✅ R*Tree migration complete!");
