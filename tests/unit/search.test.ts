import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, openDatabase } from "../../src/lib/server/database.ts";
import { createPractice } from "../../src/lib/server/practices.ts";
import { searchWorkspace } from "../../src/lib/server/search.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    closeDatabase(directory);
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("ricerca del workspace", () => {
  it("trova pratiche e documenti attivi senza distinguere maiuscole", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-search-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Successione Rossi");
    database
      .prepare(
        `INSERT INTO documents(id, practice_id, original_name, media_type, byte_size, sha256, blob_path, created_at)
         VALUES ('doc-1', ?, 'Atto di morte.pdf', 'application/pdf', 120, 'hash', 'blobs/hash', ?)`,
      )
      .run(practice.id, new Date().toISOString());

    expect(searchWorkspace(database, "rossi")[0]).toMatchObject({
      kind: "practice",
      practiceId: practice.id,
    });
    expect(searchWorkspace(database, "MORTE")[0]).toMatchObject({
      kind: "document",
      practiceId: practice.id,
      label: "Atto di morte.pdf",
    });
  });

  it("tratta percentuali e underscore come testo", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-search-"));
    directories.push(directory);
    const database = openDatabase(directory);
    createPractice(database, "Pratica 100%_sintetica");
    expect(searchWorkspace(database, "%_")).toHaveLength(1);
  });

  it("ignora le differenze di maiuscolo anche per i caratteri italiani accentati", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-search-unicode-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Eredità Bianchi");
    database
      .prepare(
        `INSERT INTO documents(id, practice_id, original_name, media_type, byte_size, sha256, blob_path, created_at)
         VALUES ('doc-accentato', ?, 'QUALITÀ.pdf', 'application/pdf', 120, 'hash-accentato', 'blobs/hash-accentato', ?)`,
      )
      .run(practice.id, new Date().toISOString());

    expect(searchWorkspace(database, "EREDITÀ")[0]).toMatchObject({
      kind: "practice",
      practiceId: practice.id,
    });
    expect(searchWorkspace(database, "qualità")[0]).toMatchObject({
      kind: "document",
      practiceId: practice.id,
    });
  });
});
