import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, openDatabase } from "../../src/lib/server/database.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    closeDatabase(directory);
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("migrazioni M3", () => {
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

    expect(tables.map(({ name }) => name)).toContain("upload_sessions");
    expect(documentColumns.map(({ name }) => name)).toContain("status");
    expect(reviewColumns.map(({ name }) => name)).toContain("source_refs_json");
    expect(runColumns.map(({ name }) => name)).toContain("output_json");
  });
});
