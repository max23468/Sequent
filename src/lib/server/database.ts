import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { getDataDirectory } from "./config.ts";

const connections = new Map<string, Database.Database>();

const migration = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS owner (
  id TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  password_changed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owner(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS practices (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'archived', 'trashed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS declarations (
  id TEXT PRIMARY KEY,
  practice_id TEXT NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  declaration_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (practice_id, sequence)
);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  practice_id TEXT NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  media_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  sha256 TEXT NOT NULL,
  blob_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (practice_id, sha256)
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  practice_id TEXT REFERENCES practices(id) ON DELETE CASCADE,
  document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
  input_hash TEXT NOT NULL,
  parameters_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  attempts INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (type, input_hash)
);
CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS declarations_practice_sequence ON declarations(practice_id, sequence);
CREATE INDEX IF NOT EXISTS jobs_status_created_at ON jobs(status, created_at);
`;

const loginRateLimitMigration = `
CREATE TABLE IF NOT EXISTS login_attempts (
  client_key TEXT PRIMARY KEY,
  failed_count INTEGER NOT NULL,
  blocked_until TEXT,
  updated_at TEXT NOT NULL
);
`;

function migratePracticeDeclarationSplit(database: Database.Database): void {
  const applied = database.prepare("SELECT 1 FROM schema_migrations WHERE version = 3").get();
  if (applied) return;
  const legacyColumns = database.pragma("table_info(practices)") as Array<{ name: string }>;
  const hasEmbeddedDeclaration = legacyColumns.some(({ name }) => name === "declaration_json");
  if (!hasEmbeddedDeclaration) {
    database
      .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (3, ?)")
      .run(new Date().toISOString());
    return;
  }

  database.pragma("foreign_keys = OFF");
  try {
    database.transaction(() => {
      database.exec(`
        INSERT OR IGNORE INTO declarations(
          id, practice_id, sequence, revision, declaration_json, created_at, updated_at
        )
        SELECT id || ':declaration:1', id, 1, revision, declaration_json, created_at, updated_at
        FROM practices;
        CREATE TABLE practices_next (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('active', 'archived', 'trashed')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO practices_next(id, title, status, created_at, updated_at)
        SELECT id, title, status, created_at, updated_at FROM practices;
        DROP TABLE practices;
        ALTER TABLE practices_next RENAME TO practices;
      `);
      database
        .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (3, ?)")
        .run(new Date().toISOString());
    })();
  } finally {
    database.pragma("foreign_keys = ON");
  }
  if ((database.pragma("foreign_key_check") as unknown[]).length > 0) {
    throw new Error("MIGRATION_FOREIGN_KEY_CHECK_FAILED");
  }
}

export function openDatabase(dataDirectory = getDataDirectory()): Database.Database {
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  const existing = connections.get(dataDirectory);
  if (existing?.open) return existing;

  const database = new Database(join(dataDirectory, "sequent.sqlite"));
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  database.exec(migration);
  database
    .prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, ?)")
    .run(new Date().toISOString());
  const applyLoginRateLimitMigration = database.transaction(() => {
    const applied = database.prepare("SELECT 1 FROM schema_migrations WHERE version = 2").get();
    if (applied) return;
    database.exec(loginRateLimitMigration);
    database
      .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (2, ?)")
      .run(new Date().toISOString());
  });
  applyLoginRateLimitMigration();
  migratePracticeDeclarationSplit(database);
  connections.set(dataDirectory, database);
  return database;
}

export function closeDatabase(dataDirectory = getDataDirectory()): void {
  const database = connections.get(dataDirectory);
  if (!database) return;
  database.close();
  connections.delete(dataDirectory);
}
