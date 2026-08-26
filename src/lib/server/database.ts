import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { getDataDirectory } from "./config.ts";
import { enqueueJob } from "./jobs.ts";

const connections = new Map<string, Database.Database>();

const foundationMigration = `
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
CREATE TABLE IF NOT EXISTS login_attempts (
  client_key TEXT PRIMARY KEY,
  failed_count INTEGER NOT NULL,
  blocked_until TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS declarations_practice_sequence ON declarations(practice_id, sequence);
CREATE INDEX IF NOT EXISTS jobs_status_created_at ON jobs(status, created_at);
`;

const m3Migration = `
CREATE TABLE IF NOT EXISTS document_artifacts (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('searchable_pdf', 'page_image', 'corrected_image', 'office_pdf', 'preview', 'extracted_text', 'ocr_tsv', 'signed_content')),
  media_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  sha256 TEXT NOT NULL,
  blob_path TEXT NOT NULL,
  page_number INTEGER CHECK (page_number IS NULL OR page_number >= 1),
  tool_name TEXT NOT NULL,
  tool_version TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE (document_id, kind, sha256, page_number)
);

CREATE TABLE IF NOT EXISTS document_pages (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL CHECK (page_number >= 1),
  text_content TEXT NOT NULL,
  coordinates_json TEXT NOT NULL DEFAULT '[]',
  confidence REAL CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  language TEXT,
  extraction_method TEXT NOT NULL CHECK (extraction_method IN ('native', 'ocr', 'structured', 'conversion')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (document_id, page_number)
);

CREATE TABLE IF NOT EXISTS review_items (
  id TEXT PRIMARY KEY,
  practice_id TEXT NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
  page_number INTEGER CHECK (page_number IS NULL OR page_number >= 1),
  subject_key TEXT NOT NULL,
  label TEXT NOT NULL,
  proposed_value_json TEXT NOT NULL,
  alternatives_json TEXT NOT NULL DEFAULT '[]',
  method TEXT NOT NULL CHECK (method IN ('structured', 'native_text', 'ocr', 'rule', 'codex', 'calculation', 'manual')),
  confidence REAL CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  source_excerpt TEXT,
  source_refs_json TEXT NOT NULL DEFAULT '[]',
  rule_version TEXT,
  prompt_version TEXT,
  critical INTEGER NOT NULL DEFAULT 0 CHECK (critical IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'edited', 'rejected', 'ignored')),
  decided_value_json TEXT,
  decision_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS codex_threads (
  practice_id TEXT PRIMARY KEY REFERENCES practices(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS codex_runs (
  id TEXT PRIMARY KEY,
  practice_id TEXT NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  thread_id TEXT,
  snapshot_hash TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  model TEXT NOT NULL,
  effort TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  usage_json TEXT,
  output_json TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS upload_sessions (
  id TEXT PRIMARY KEY,
  practice_id TEXT REFERENCES practices(id) ON DELETE CASCADE,
  new_practice_title TEXT,
  original_name TEXT NOT NULL,
  media_type TEXT NOT NULL,
  total_size INTEGER NOT NULL CHECK (total_size > 0 AND total_size <= 262144000),
  received_size INTEGER NOT NULL DEFAULT 0 CHECK (received_size >= 0 AND received_size <= total_size),
  temp_path TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'completing', 'completed', 'failed')),
  result_document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  CHECK ((practice_id IS NOT NULL) <> (new_practice_title IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS document_artifacts_document ON document_artifacts(document_id, kind, page_number);
CREATE INDEX IF NOT EXISTS document_pages_document ON document_pages(document_id, page_number);
CREATE INDEX IF NOT EXISTS review_items_practice_status ON review_items(practice_id, status, created_at);
CREATE INDEX IF NOT EXISTS review_items_document ON review_items(document_id, page_number);
CREATE INDEX IF NOT EXISTS codex_runs_practice_created ON codex_runs(practice_id, created_at);
CREATE INDEX IF NOT EXISTS upload_sessions_expires ON upload_sessions(expires_at, status);

UPDATE documents SET updated_at = created_at WHERE updated_at IS NULL;
`;

function hasColumn(database: Database.Database, table: string, column: string): boolean {
  return (database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(
    (candidate) => candidate.name === column,
  );
}

function addColumnIfMissing(
  database: Database.Database,
  table: string,
  column: string,
  declaration: string,
): void {
  if (!hasColumn(database, table, column))
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
}

function applyM3Migration(database: Database.Database): void {
  database.transaction(() => {
    addColumnIfMissing(
      database,
      "documents",
      "status",
      `TEXT NOT NULL DEFAULT 'received'
       CHECK (status IN ('received', 'classifying', 'processing', 'processed', 'to_review', 'superseded', 'authoritative', 'candidate_attachment', 'included_attachment', 'unsupported', 'unreadable', 'excluded'))`,
    );
    addColumnIfMissing(database, "documents", "detected_format", "TEXT");
    addColumnIfMissing(
      database,
      "documents",
      "page_count",
      "INTEGER CHECK (page_count IS NULL OR page_count >= 0)",
    );
    addColumnIfMissing(database, "documents", "language", "TEXT");
    addColumnIfMissing(database, "documents", "processing_error", "TEXT");
    addColumnIfMissing(database, "documents", "updated_at", "TEXT");
    database.exec(m3Migration);
    addColumnIfMissing(database, "review_items", "source_refs_json", "TEXT NOT NULL DEFAULT '[]'");
    addColumnIfMissing(database, "codex_runs", "output_json", "TEXT");
    addColumnIfMissing(
      database,
      "upload_sessions",
      "result_document_id",
      "TEXT REFERENCES documents(id) ON DELETE CASCADE",
    );
    const documentsToProcess = database
      .prepare(
        `SELECT id, practice_id, sha256
         FROM documents
         WHERE status = 'received'
           AND NOT EXISTS (
             SELECT 1 FROM jobs
             WHERE jobs.type = 'document.process'
               AND jobs.document_id = documents.id
           )`,
      )
      .all() as Array<{ id: string; practice_id: string; sha256: string }>;
    for (const document of documentsToProcess) {
      enqueueJob(
        database,
        "document.process",
        { sha256: document.sha256, pipelineVersion: 1 },
        { practiceId: document.practice_id, documentId: document.id },
      );
    }
    database
      .prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (2, ?)")
      .run(new Date().toISOString());
  })();
}

function applyMigrations(database: Database.Database): void {
  database.exec(foundationMigration);
  database
    .prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, ?)")
    .run(new Date().toISOString());
  // Lo schema è la fonte di verità: riparare anche database provenienti da una
  // migrazione M3 interrotta o da checkout concorrenti con numeri già occupati.
  applyM3Migration(database);
}

export function openDatabase(dataDirectory = getDataDirectory()): Database.Database {
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  const existing = connections.get(dataDirectory);
  if (existing?.open) return existing;

  const database = new Database(join(dataDirectory, "sequent.sqlite"));
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  applyMigrations(database);
  connections.set(dataDirectory, database);
  return database;
}

export function closeDatabase(dataDirectory = getDataDirectory()): void {
  const database = connections.get(dataDirectory);
  if (!database) return;
  database.close();
  connections.delete(dataDirectory);
}
