import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, openDatabase } from "../../src/lib/server/database.ts";
import { createPractice, saveDeclaration } from "../../src/lib/server/practices.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    closeDatabase(directory);
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("persistenza delle pratiche", () => {
  it("rifiuta un salvataggio basato su una revisione superata", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-practice-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Pratica sintetica");
    expect(
      saveDeclaration(database, practice.id, 1, { schemaVersion: 1, fields: { note: "prima" } }),
    ).toBe(2);
    expect(() =>
      saveDeclaration(database, practice.id, 1, { schemaVersion: 1, fields: { note: "persa" } }),
    ).toThrow("REVISION_CONFLICT");
  });
});
