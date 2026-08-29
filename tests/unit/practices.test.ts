import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, openDatabase } from "../../src/lib/server/database.ts";
import {
  createPractice,
  getPractice,
  listPractices,
  renamePractice,
  saveDeclaration,
} from "../../src/lib/server/practices.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    closeDatabase(directory);
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("persistenza delle pratiche", () => {
  it("rinomina una pratica attiva normalizzando il titolo", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-practice-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Titolo iniziale");
    expect(renamePractice(database, practice.id, "  Titolo aggiornato  ")).toBe(true);
    expect(getPractice(database, practice.id)?.title).toBe("Titolo aggiornato");
    expect(() => renamePractice(database, practice.id, "   ")).toThrow("INVALID_PRACTICE_TITLE");
  });

  it("rifiuta un salvataggio basato su una revisione superata", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-practice-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Pratica sintetica");
    expect(
      saveDeclaration(database, practice.declarationId, 1, {
        schemaVersion: 1,
        fields: { note: "prima" },
      }),
    ).toBe(2);
    expect(() =>
      saveDeclaration(database, practice.declarationId, 1, {
        schemaVersion: 1,
        fields: { note: "persa" },
      }),
    ).toThrow("REVISION_CONFLICT");
  });

  it("ordina le pratiche per attività recente e conta i documenti reali", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-practice-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const older = createPractice(database, "Pratica precedente");
    const latest = createPractice(database, "Pratica recente");
    database
      .prepare("UPDATE practices SET updated_at = ? WHERE id = ?")
      .run("2026-01-01T00:00:00.000Z", older.id);
    database
      .prepare(
        `INSERT INTO documents(id, practice_id, original_name, media_type, byte_size, sha256, blob_path, created_at)
         VALUES ('doc-count', ?, 'documento.pdf', 'application/pdf', 10, 'count-hash', 'blobs/count', ?)`,
      )
      .run(latest.id, new Date().toISOString());
    expect(listPractices(database)).toMatchObject([
      { id: latest.id, documentCount: 1 },
      { id: older.id, documentCount: 0 },
    ]);
  });

  it("crea direttamente lo schema corrente senza colonne incorporate obsolete", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-practice-"));
    directories.push(directory);
    const database = openDatabase(directory);
    expect(createPractice(database, "Nuovo procedimento").revision).toBe(1);
    expect(
      (database.pragma("table_info(practices)") as Array<{ name: string }>).map(({ name }) => name),
    ).not.toContain("declaration_json");
    expect(
      (database.prepare("SELECT count(*) AS count FROM declarations").get() as { count: number })
        .count,
    ).toBe(1);
  });
});
