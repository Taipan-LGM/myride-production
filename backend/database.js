import Database from "better-sqlite3";
import dotenv from "dotenv";

dotenv.config();

const SQLITE_PATH = process.env.SQLITE_PATH || "./mycab.sqlite";

export const db = new Database(SQLITE_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function hasColumn(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}

function migrate() {
  // Add external identity columns if this DB was created before they existed
  if (hasColumn("users", "external_source") === false) {
    db.exec("ALTER TABLE users ADD COLUMN external_source TEXT");
  }
  if (hasColumn("users", "external_id") === false) {
    db.exec("ALTER TABLE users ADD COLUMN external_id TEXT");
  }

  // Ensure unique index exists (no-op if present)
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_external ON users(external_source, external_id)"
  );
}

export function initDatabase(schemaSql) {
  db.exec(schemaSql);
  migrate();
}

