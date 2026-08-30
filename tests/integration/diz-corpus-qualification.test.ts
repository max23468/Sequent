import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { closeDatabase, openDatabase } from "../../src/lib/server/database.ts";
import { createSharedSubject } from "../../src/lib/server/domain-subjects.ts";
import { importDiz } from "../../src/lib/server/official-flow.ts";
import { createPractice } from "../../src/lib/server/practices.ts";
import { syntheticDiz } from "../fixtures/synthetic-diz.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    closeDatabase(directory);
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("qualificazione privata del corpus DIZ", () => {
  it("rilegge cinque DIZ univoci dall'archivio e dal modello canonico", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-diz-corpus-"));
    const corpus = join(directory, "corpus");
    mkdirSync(corpus);
    directories.push(directory);
    const database = openDatabase(directory);
    for (let index = 0; index < 5; index += 1) {
      const practice = createPractice(database, `Pratica sintetica ${index + 1}`);
      createSharedSubject(database, practice.id, {
        role: "beneficiary",
        displayName: `Soggetto sintetico ${index + 1}`,
        declarationId: practice.declarationId,
      });
      const bytes = syntheticDiz(`COGNOME${index + 1}`);
      writeFileSync(join(corpus, `campione-${index + 1}.diz`), bytes);
      await importDiz(database, {
        practiceId: practice.id,
        declarationId: practice.declarationId,
        file: new File([new Uint8Array(bytes)], `campione-${index + 1}.diz`),
        dataDirectory: directory,
      });
    }
    closeDatabase(directory);

    const result = spawnSync(
      process.execPath,
      ["scripts/admin/qualify-diz-corpus.ts", "--corpus", corpus, "--data-dir", directory],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      format: "sequent-diz-corpus-qualification",
      corpusFiles: 5,
      uniqueFiles: 5,
      passed: true,
      samples: expect.arrayContaining([
        expect.objectContaining({ qualifiedFields: 1, readbackVerified: true }),
      ]),
    });
  });
});
