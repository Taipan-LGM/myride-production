/**
 * Apply db/schema.sql then backend/database.js migrations (app_settings, failed_address_attempts, etc.).
 * Prefer this over the legacy inline `db:init` one-liner which skipped migrations.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const { initDatabase } = await import(
  pathToFileURL(path.join(root, "backend", "database.js")).href
);
const schema = fs.readFileSync(path.join(root, "db", "schema.sql"), "utf8");

initDatabase(schema);
console.log("Database schema + migrations applied.");
