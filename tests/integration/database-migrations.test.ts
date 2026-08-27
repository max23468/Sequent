import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, openDatabase } from "../../src/lib/server/database.ts";
import { runJobRunnerTick } from "../../src/lib/server/job-runner.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    closeDatabase(directory);
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("migrazioni M3", () => {
  it("verifica ed elabora una sola volta i documenti provenienti da M2", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-m2-document-migration-"));
    directories.push(directory);
    const path = join(directory, "sequent.sqlite");
    const blob = Buffer.from("contenuto legacy sintetico");
    const sha256 = createHash("sha256").update(blob).digest("hex");
    mkdirSync(join(directory, "blobs"), { mode: 0o700 });
    writeFileSync(join(directory, "blobs", "legacy"), blob, { mode: 0o600 });
    const legacy = new Database(path);
    legacy.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE practices (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'archived', 'trashed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE documents (
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
      CREATE TABLE jobs (
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
      INSERT INTO schema_migrations(version, applied_at)
      VALUES (1, '2026-08-25T00:00:00.000Z');
      INSERT INTO practices(id, title, status, created_at, updated_at)
      VALUES ('practice-m2', 'Pratica M2', 'active', '2026-08-25T00:00:00.000Z', '2026-08-25T00:00:00.000Z');
    `);
    legacy
      .prepare(
        `INSERT INTO documents(
           id, practice_id, original_name, media_type, byte_size, sha256, blob_path, created_at
         ) VALUES (
           'document-m2', 'practice-m2', 'legacy.txt', 'text/plain', ?, ?,
           'blobs/legacy', '2026-08-25T00:00:00.000Z'
         )`,
      )
      .run(blob.byteLength, sha256);
    legacy.close();

    const previousDataDirectory = process.env.SEQUENT_DATA_DIR;
    process.env.SEQUENT_DATA_DIR = directory;
    try {
      let migrated = openDatabase(directory);
      expect(
        migrated
          .prepare("SELECT type, status FROM jobs WHERE document_id = ? ORDER BY type")
          .all("document-m2"),
      ).toEqual([
        { type: "document.process", status: "queued" },
        { type: "foundation.verify_blob", status: "queued" },
      ]);

      await runJobRunnerTick(migrated);
      await runJobRunnerTick(migrated);
      expect(
        migrated
          .prepare("SELECT type, status FROM jobs WHERE document_id = ? ORDER BY type")
          .all("document-m2"),
      ).toEqual([
        { type: "document.process", status: "completed" },
        { type: "foundation.verify_blob", status: "completed" },
      ]);
      expect(
        migrated.prepare("SELECT status FROM documents WHERE id = ?").get("document-m2"),
      ).toEqual({ status: "processed" });

      closeDatabase(directory);
      migrated = openDatabase(directory);
      expect(
        migrated
          .prepare("SELECT type, count(*) AS count FROM jobs WHERE document_id = ? GROUP BY type")
          .all("document-m2"),
      ).toEqual([
        { type: "document.process", count: 1 },
        { type: "foundation.verify_blob", count: 1 },
      ]);
    } finally {
      if (previousDataDirectory === undefined) delete process.env.SEQUENT_DATA_DIR;
      else process.env.SEQUENT_DATA_DIR = previousDataDirectory;
    }
  });

  it("ripara uno schema parziale anche se contiene versioni successive", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-m3-migration-"));
    directories.push(directory);
    const path = join(directory, "sequent.sqlite");
    const partial = new Database(path);
    partial.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      INSERT INTO schema_migrations(version, applied_at)
      VALUES (1, '2026-08-25T00:00:00.000Z'),
             (2, '2026-08-25T00:00:01.000Z'),
             (3, '2026-08-25T00:00:02.000Z');
    `);
    partial.close();

    const migrated = openDatabase(directory);
    const tables = migrated
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[];
    const documentColumns = migrated.prepare("PRAGMA table_info(documents)").all() as {
      name: string;
    }[];
    const reviewColumns = migrated.prepare("PRAGMA table_info(review_items)").all() as {
      name: string;
    }[];
    const runColumns = migrated.prepare("PRAGMA table_info(codex_runs)").all() as {
      name: string;
    }[];
    const uploadColumns = migrated.prepare("PRAGMA table_info(upload_sessions)").all() as {
      name: string;
    }[];

    expect(tables.map(({ name }) => name)).toContain("upload_sessions");
    expect(documentColumns.map(({ name }) => name)).toContain("status");
    expect(reviewColumns.map(({ name }) => name)).toContain("source_refs_json");
    expect(runColumns.map(({ name }) => name)).toContain("output_json");
    expect(uploadColumns.map(({ name }) => name)).toContain("result_document_id");
  });
});
