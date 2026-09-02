import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
    const reportPath = join(directory, "qualification", "diz-corpus.json");
    mkdirSync(corpus);
    directories.push(directory);
    const database = openDatabase(directory);
    for (let index = 0; index < 5; index += 1) {
      const practice = createPractice(database, `Pratica sintetica ${index + 1}`);
      const bytes = syntheticDiz(
        `COGNOME${index + 1}`,
        index === 0
          ? {
              name: "allegato-sintetico.pdf",
              content: Buffer.from("%PDF-1.7\nAllegato sintetico\n%%EOF", "ascii"),
            }
          : undefined,
      );
      writeFileSync(join(corpus, `campione-${index + 1}.diz`), bytes);
      if (index === 0) {
        await importDiz(database, {
          practiceId: practice.id,
          declarationId: practice.declarationId,
          file: new File([new Uint8Array(bytes)], "tentativo-incompleto.diz"),
          dataDirectory: directory,
        });
      }
      createSharedSubject(database, practice.id, {
        role: "beneficiary",
        displayName: `Soggetto sintetico ${index + 1}`,
        declarationId: practice.declarationId,
      });
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
      [
        "scripts/admin/qualify-diz-corpus.ts",
        "--corpus",
        corpus,
        "--data-dir",
        directory,
        "--output",
        reportPath,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, SEQUENT_COMMIT_SHA: "a".repeat(40) },
      },
    );

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      format: "sequent-diz-corpus-qualification",
      commit: "a".repeat(40),
      corpusFiles: 5,
      uniqueFiles: 5,
      passed: true,
      samples: expect.arrayContaining([
        expect.objectContaining({
          mappedFields: 2,
          materializedAttachments: 1,
          qualifiedEgAttachmentLinks: 1,
          egCountsMatch: true,
          archiveArtifacts: 2,
          readbackVerified: true,
        }),
      ]),
    });
    expect(JSON.parse(readFileSync(reportPath, "utf8"))).toMatchObject({ passed: true });
    expect(statSync(reportPath).mode & 0o777).toBe(0o600);
    expect(statSync(join(directory, "qualification")).mode & 0o777).toBe(0o700);
  });

  it("rifiuta prove non legate a una release e metadati di acquisizione incoerenti", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-diz-corpus-invalid-"));
    const corpus = join(directory, "corpus");
    mkdirSync(corpus);
    directories.push(directory);
    const database = openDatabase(directory);
    for (let index = 0; index < 5; index += 1) {
      const practice = createPractice(database, `Pratica incoerente ${index + 1}`);
      createSharedSubject(database, practice.id, {
        role: "beneficiary",
        displayName: `Soggetto incoerente ${index + 1}`,
        declarationId: practice.declarationId,
      });
      const bytes = syntheticDiz(`INCOERENTE${index + 1}`);
      writeFileSync(join(corpus, `campione-${index + 1}.diz`), bytes);
      const artifact = await importDiz(database, {
        practiceId: practice.id,
        declarationId: practice.declarationId,
        file: new File([new Uint8Array(bytes)], `campione-${index + 1}.diz`),
        dataDirectory: directory,
      });
      if (index === 0) {
        database
          .prepare("UPDATE official_artifacts SET metadata_json = ? WHERE id = ?")
          .run(JSON.stringify({ ...artifact.metadata, fields: 999 }), artifact.id);
      }
    }
    closeDatabase(directory);

    const withoutRelease = spawnSync(
      process.execPath,
      ["scripts/admin/qualify-diz-corpus.ts", "--corpus", corpus, "--data-dir", directory],
      { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, SEQUENT_COMMIT_SHA: "" } },
    );
    expect(withoutRelease.status).not.toBe(0);
    expect(withoutRelease.stderr).toContain("DIZ_CORPUS_QUALIFICATION_RELEASE_REQUIRED");

    const inconsistent = spawnSync(
      process.execPath,
      ["scripts/admin/qualify-diz-corpus.ts", "--corpus", corpus, "--data-dir", directory],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, SEQUENT_COMMIT_SHA: "b".repeat(40) },
      },
    );
    expect(inconsistent.status).not.toBe(0);
    expect(inconsistent.stderr).toContain("DIZ_CORPUS_QUALIFICATION_ACQUISITION_INCOMPLETE:1");
  });
});
