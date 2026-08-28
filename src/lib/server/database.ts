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

const documentPipelineMigration = `
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

const domainMigration = `
CREATE TABLE IF NOT EXISTS shared_subjects (
  id TEXT PRIMARY KEY,
  practice_id TEXT NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('decedent', 'beneficiary', 'representative', 'other')),
  display_name TEXT NOT NULL,
  tax_code TEXT,
  data_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shared_assets (
  id TEXT PRIMARY KEY,
  practice_id TEXT NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('property', 'financial', 'other_asset', 'liability', 'donation')),
  display_name TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS checklist_items (
  id TEXT PRIMARY KEY,
  practice_id TEXT NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  declaration_id TEXT NOT NULL REFERENCES declarations(id) ON DELETE CASCADE,
  requirement_kind TEXT NOT NULL CHECK (requirement_kind IN ('attachment', 'source', 'retain', 'subsequent_proof')),
  importance TEXT NOT NULL CHECK (importance IN ('blocking', 'conditional', 'recommended')),
  label TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('missing', 'available', 'not_applicable', 'overridden')),
  source_refs_json TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  decision_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS devolution_scenarios (
  id TEXT PRIMARY KEY,
  practice_id TEXT NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  declaration_id TEXT NOT NULL REFERENCES declarations(id) ON DELETE CASCADE,
  ruleset_version TEXT NOT NULL,
  input_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  issues_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'blocked', 'confirmed', 'superseded')),
  confirmed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS calculation_runs (
  id TEXT PRIMARY KEY,
  practice_id TEXT NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  declaration_id TEXT NOT NULL REFERENCES declarations(id) ON DELETE CASCADE,
  ruleset_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  input_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  issues_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'blocked', 'confirmed', 'superseded')),
  confirmed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (declaration_id, ruleset_version, input_hash)
);

CREATE TABLE IF NOT EXISTS domain_audit_events (
  id TEXT PRIMARY KEY,
  practice_id TEXT NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  declaration_id TEXT REFERENCES declarations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS workspace_search USING fts5(
  kind UNINDEXED,
  entity_id UNINDEXED,
  practice_id UNINDEXED,
  label,
  context,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS workspace_search_practice_insert AFTER INSERT ON practices BEGIN
  INSERT INTO workspace_search(kind, entity_id, practice_id, label, context)
  SELECT 'practice', new.id, new.id, new.title, 'Pratica' WHERE new.status = 'active';
END;
DROP TRIGGER IF EXISTS workspace_search_practice_update;
CREATE TRIGGER workspace_search_practice_update AFTER UPDATE ON practices BEGIN
  DELETE FROM workspace_search WHERE kind = 'practice' AND entity_id = old.id;
  DELETE FROM workspace_search WHERE kind = 'document' AND practice_id = old.id;
  INSERT INTO workspace_search(kind, entity_id, practice_id, label, context)
  SELECT 'practice', new.id, new.id, new.title, 'Pratica' WHERE new.status = 'active';
  INSERT INTO workspace_search(kind, entity_id, practice_id, label, context)
  SELECT 'document', documents.id, documents.practice_id, documents.original_name, new.title
  FROM documents WHERE documents.practice_id = new.id AND new.status = 'active';
END;
CREATE TRIGGER IF NOT EXISTS workspace_search_practice_delete AFTER DELETE ON practices BEGIN
  DELETE FROM workspace_search WHERE kind = 'practice' AND entity_id = old.id;
END;
CREATE TRIGGER IF NOT EXISTS workspace_search_document_insert AFTER INSERT ON documents BEGIN
  INSERT INTO workspace_search(kind, entity_id, practice_id, label, context)
  SELECT 'document', new.id, new.practice_id, new.original_name, practices.title
  FROM practices WHERE practices.id = new.practice_id AND practices.status = 'active';
END;
CREATE TRIGGER IF NOT EXISTS workspace_search_document_update AFTER UPDATE ON documents BEGIN
  DELETE FROM workspace_search WHERE kind = 'document' AND entity_id = old.id;
  INSERT INTO workspace_search(kind, entity_id, practice_id, label, context)
  SELECT 'document', new.id, new.practice_id, new.original_name, practices.title
  FROM practices WHERE practices.id = new.practice_id AND practices.status = 'active';
END;
CREATE TRIGGER IF NOT EXISTS workspace_search_document_delete AFTER DELETE ON documents BEGIN
  DELETE FROM workspace_search WHERE kind = 'document' AND entity_id = old.id;
END;
CREATE TRIGGER IF NOT EXISTS workspace_search_subject_insert AFTER INSERT ON shared_subjects BEGIN
  INSERT INTO workspace_search(kind, entity_id, practice_id, label, context)
  VALUES ('subject', new.id, new.practice_id, new.display_name, coalesce(new.tax_code, ''));
END;
CREATE TRIGGER IF NOT EXISTS workspace_search_subject_update AFTER UPDATE ON shared_subjects BEGIN
  DELETE FROM workspace_search WHERE kind = 'subject' AND entity_id = old.id;
  INSERT INTO workspace_search(kind, entity_id, practice_id, label, context)
  VALUES ('subject', new.id, new.practice_id, new.display_name, coalesce(new.tax_code, ''));
END;
CREATE TRIGGER IF NOT EXISTS workspace_search_subject_delete AFTER DELETE ON shared_subjects BEGIN
  DELETE FROM workspace_search WHERE kind = 'subject' AND entity_id = old.id;
END;
CREATE TRIGGER IF NOT EXISTS workspace_search_asset_insert AFTER INSERT ON shared_assets BEGIN
  INSERT INTO workspace_search(kind, entity_id, practice_id, label, context)
  VALUES ('asset', new.id, new.practice_id, new.display_name, new.category);
END;
CREATE TRIGGER IF NOT EXISTS workspace_search_asset_update AFTER UPDATE ON shared_assets BEGIN
  DELETE FROM workspace_search WHERE kind = 'asset' AND entity_id = old.id;
  INSERT INTO workspace_search(kind, entity_id, practice_id, label, context)
  VALUES ('asset', new.id, new.practice_id, new.display_name, new.category);
END;
CREATE TRIGGER IF NOT EXISTS workspace_search_asset_delete AFTER DELETE ON shared_assets BEGIN
  DELETE FROM workspace_search WHERE kind = 'asset' AND entity_id = old.id;
END;

CREATE INDEX IF NOT EXISTS shared_subjects_practice_role ON shared_subjects(practice_id, role, updated_at);
CREATE INDEX IF NOT EXISTS shared_assets_practice_category ON shared_assets(practice_id, category, updated_at);
CREATE INDEX IF NOT EXISTS checklist_practice_status ON checklist_items(practice_id, status, importance);
CREATE INDEX IF NOT EXISTS devolution_practice_declaration ON devolution_scenarios(practice_id, declaration_id, updated_at);
CREATE INDEX IF NOT EXISTS calculations_practice_declaration ON calculation_runs(practice_id, declaration_id, updated_at);
CREATE INDEX IF NOT EXISTS domain_audit_practice_created ON domain_audit_events(practice_id, created_at);
`;

const declarationSubjectEntriesMigration = `
CREATE TABLE IF NOT EXISTS declaration_subject_entries (
  declaration_id TEXT NOT NULL REFERENCES declarations(id) ON DELETE CASCADE,
  entry_id TEXT NOT NULL,
  subject_id TEXT NOT NULL REFERENCES shared_subjects(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  created_at TEXT NOT NULL,
  PRIMARY KEY (declaration_id, entry_id),
  UNIQUE (declaration_id, sequence)
);

CREATE INDEX IF NOT EXISTS declaration_subject_entries_subject
  ON declaration_subject_entries(subject_id, declaration_id);
`;

const declarationAssetEntriesMigration = `
CREATE TABLE IF NOT EXISTS declaration_asset_entries (
  declaration_id TEXT NOT NULL REFERENCES declarations(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES shared_assets(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (declaration_id, asset_id)
);

CREATE INDEX IF NOT EXISTS declaration_asset_entries_asset
  ON declaration_asset_entries(asset_id, declaration_id);
`;

const officialAttachmentsMigration = `
CREATE TABLE IF NOT EXISTS official_attachments (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  practice_id TEXT NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  prepared_name TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('PDF/A-1b', 'TIFF-G4')),
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 5242880),
  sha256 TEXT NOT NULL,
  blob_path TEXT NOT NULL,
  validation_json TEXT NOT NULL,
  source_refs_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (document_id, sha256)
);

CREATE INDEX IF NOT EXISTS official_attachments_practice
  ON official_attachments(practice_id, document_id, created_at);
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

function applyDocumentPipelineMigration(database: Database.Database): void {
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
    database.exec(documentPipelineMigration);
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
         WHERE status = 'received'`,
      )
      .all() as Array<{ id: string; practice_id: string; sha256: string }>;
    for (const document of documentsToProcess) {
      enqueueJob(
        database,
        "foundation.verify_blob",
        { sha256: document.sha256 },
        { practiceId: document.practice_id, documentId: document.id },
      );
      enqueueJob(
        database,
        "document.process",
        { sha256: document.sha256, pipelineVersion: 1 },
        { practiceId: document.practice_id, documentId: document.id },
      );
      database
        .prepare(
          `UPDATE jobs
           SET status = 'queued', progress = 0, error_code = NULL, updated_at = ?
           WHERE type = 'document.process' AND document_id = ?
             AND status = 'failed' AND error_code = 'BLOB_VERIFICATION_REQUIRED'`,
        )
        .run(new Date().toISOString(), document.id);
    }
    database
      .prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (2, ?)")
      .run(new Date().toISOString());
  })();
}

function applyDomainMigration(database: Database.Database): void {
  database.transaction(() => {
    database.exec(domainMigration);
    database.exec("DELETE FROM workspace_search");
    database.exec(`
      INSERT INTO workspace_search(kind, entity_id, practice_id, label, context)
      SELECT 'practice', id, id, title, 'Pratica' FROM practices WHERE status = 'active';
      INSERT INTO workspace_search(kind, entity_id, practice_id, label, context)
      SELECT 'document', documents.id, documents.practice_id, documents.original_name, practices.title
      FROM documents JOIN practices ON practices.id = documents.practice_id
      WHERE practices.status = 'active';
      INSERT INTO workspace_search(kind, entity_id, practice_id, label, context)
      SELECT 'subject', shared_subjects.id, shared_subjects.practice_id, shared_subjects.display_name,
             coalesce(shared_subjects.tax_code, '')
      FROM shared_subjects JOIN practices ON practices.id = shared_subjects.practice_id
      WHERE practices.status = 'active';
      INSERT INTO workspace_search(kind, entity_id, practice_id, label, context)
      SELECT 'asset', shared_assets.id, shared_assets.practice_id, shared_assets.display_name,
             shared_assets.category
      FROM shared_assets JOIN practices ON practices.id = shared_assets.practice_id
      WHERE practices.status = 'active';
    `);
    database
      .prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (3, ?)")
      .run(new Date().toISOString());
  })();
}

function applyDeclarationSubjectEntriesMigration(database: Database.Database): void {
  database.transaction(() => {
    database.exec(declarationSubjectEntriesMigration);
    const alreadyApplied = database
      .prepare("SELECT 1 FROM schema_migrations WHERE version = 4")
      .get();
    if (alreadyApplied) return;
    database.exec(`
      INSERT INTO declaration_subject_entries(
        declaration_id, entry_id, subject_id, sequence, created_at
      )
      SELECT declarations.id,
             shared_subjects.id,
             shared_subjects.id,
             row_number() OVER (
               PARTITION BY declarations.id
               ORDER BY shared_subjects.created_at, shared_subjects.id
             ),
             shared_subjects.created_at
      FROM declarations
      JOIN shared_subjects ON shared_subjects.practice_id = declarations.practice_id
      WHERE shared_subjects.role <> 'decedent';
    `);
    database
      .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (4, ?)")
      .run(new Date().toISOString());
  })();
}

function applyDeclarationAssetEntriesMigration(database: Database.Database): void {
  database.transaction(() => {
    database.exec(declarationAssetEntriesMigration);
    const alreadyApplied = database
      .prepare("SELECT 1 FROM schema_migrations WHERE version = 5")
      .get();
    if (alreadyApplied) return;
    database.exec(`
      INSERT INTO declaration_asset_entries(declaration_id, asset_id, created_at)
      SELECT declarations.id, shared_assets.id, shared_assets.created_at
      FROM declarations
      JOIN shared_assets ON shared_assets.practice_id = declarations.practice_id;
    `);
    database
      .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (5, ?)")
      .run(new Date().toISOString());
  })();
}

function applyDeclarationSubjectSnapshotsMigration(database: Database.Database): void {
  database.transaction(() => {
    addColumnIfMissing(database, "declaration_subject_entries", "role_snapshot", "TEXT");
    addColumnIfMissing(database, "declaration_subject_entries", "display_name_snapshot", "TEXT");
    addColumnIfMissing(database, "declaration_subject_entries", "tax_code_snapshot", "TEXT");
    const alreadyApplied = database
      .prepare("SELECT 1 FROM schema_migrations WHERE version = 6")
      .get();
    if (alreadyApplied) return;
    database.exec(`
      UPDATE declaration_subject_entries
      SET role_snapshot = (
            SELECT role FROM shared_subjects
            WHERE shared_subjects.id = declaration_subject_entries.subject_id
          ),
          display_name_snapshot = (
            SELECT display_name FROM shared_subjects
            WHERE shared_subjects.id = declaration_subject_entries.subject_id
          ),
          tax_code_snapshot = (
            SELECT tax_code FROM shared_subjects
            WHERE shared_subjects.id = declaration_subject_entries.subject_id
          );
    `);
    database
      .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (6, ?)")
      .run(new Date().toISOString());
  })();
}

function applyOfficialAttachmentsMigration(database: Database.Database): void {
  database.transaction(() => {
    database.exec(officialAttachmentsMigration);
    database
      .prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (7, ?)")
      .run(new Date().toISOString());
  })();
}

function applyCalculationResultsV2Migration(database: Database.Database): void {
  database.transaction(() => {
    const alreadyApplied = database
      .prepare("SELECT 1 FROM schema_migrations WHERE version = 8")
      .get();
    if (alreadyApplied) return;

    // I risultati precedenti non contengono il riepilogo delle imposte né il piano
    // di pagamento del formato corrente. Sono calcoli derivati e riproducibili: eliminarli
    // evita di presentarli come attuali e obbliga a ricalcolarli con le regole vigenti.
    database.exec("DELETE FROM calculation_runs");
    const declarations = database
      .prepare("SELECT id, declaration_json FROM declarations")
      .all() as Array<{ id: string; declaration_json: string }>;
    const updateDeclaration = database.prepare(
      "UPDATE declarations SET declaration_json = ?, updated_at = ? WHERE id = ?",
    );
    const now = new Date().toISOString();
    for (const declaration of declarations) {
      const snapshot = JSON.parse(declaration.declaration_json) as Record<string, unknown>;
      if (snapshot.latestCalculationRunId == null) continue;
      snapshot.latestCalculationRunId = null;
      updateDeclaration.run(JSON.stringify(snapshot), now, declaration.id);
    }
    database.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (8, ?)").run(now);
  })();
}

function applyCalculationRulesMigration(
  database: Database.Database,
  version: 9 | 10 | 11 | 12 | 13,
  rulesetVersion: "2026.08.5" | "2026.08.6" | "2026.08.7" | "2026.08.8" | "2026.08.9",
): void {
  database.transaction(() => {
    const alreadyApplied = database
      .prepare("SELECT 1 FROM schema_migrations WHERE version = ?")
      .get(version);
    if (alreadyApplied) return;

    // I risultati sono derivati e riproducibili: ogni nuova versione fiscale impone il ricalcolo.
    database.exec("DELETE FROM calculation_runs");
    const declarations = database
      .prepare("SELECT id, declaration_json FROM declarations")
      .all() as Array<{ id: string; declaration_json: string }>;
    const updateDeclaration = database.prepare(
      "UPDATE declarations SET declaration_json = ?, updated_at = ? WHERE id = ?",
    );
    const now = new Date().toISOString();
    for (const declaration of declarations) {
      const snapshot = JSON.parse(declaration.declaration_json) as Record<string, unknown>;
      snapshot.latestCalculationRunId = null;
      snapshot.rulesetVersion = rulesetVersion;
      updateDeclaration.run(JSON.stringify(snapshot), now, declaration.id);
    }
    database
      .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
      .run(version, now);
  })();
}

function applyMigrations(database: Database.Database): void {
  database.exec(foundationMigration);
  database
    .prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, ?)")
    .run(new Date().toISOString());
  // Lo schema è la fonte di verità: riparare anche database provenienti da una
  // migrazione della pipeline documentale interrotta o da checkout concorrenti con numeri già occupati.
  applyDocumentPipelineMigration(database);
  applyDomainMigration(database);
  applyDeclarationSubjectEntriesMigration(database);
  applyDeclarationAssetEntriesMigration(database);
  applyDeclarationSubjectSnapshotsMigration(database);
  applyOfficialAttachmentsMigration(database);
  applyCalculationResultsV2Migration(database);
  applyCalculationRulesMigration(database, 9, "2026.08.5");
  applyCalculationRulesMigration(database, 10, "2026.08.6");
  applyCalculationRulesMigration(database, 11, "2026.08.7");
  applyCalculationRulesMigration(database, 12, "2026.08.8");
  applyCalculationRulesMigration(database, 13, "2026.08.9");
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
