import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, openDatabase } from "../../src/lib/server/database.ts";
import { ingestDocument } from "../../src/lib/server/document-ingestion.ts";
import { runJobRunnerTick } from "../../src/lib/server/job-runner.ts";
import { claimNextJob, enqueueJob, finishJob } from "../../src/lib/server/jobs.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    closeDatabase(directory);
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("acquisizione documentale", () => {
  it("crea pratica, documento e job in un unico esito applicativo", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-ingestion-"));
    directories.push(directory);
    const database = openDatabase(directory);

    const document = await ingestDocument(
      database,
      new File(["contenuto sintetico"], "originale.txt", { type: "text/plain" }),
      { newPracticeTitle: "Pratica da documento" },
      directory,
    );

    expect(
      database.prepare("SELECT title FROM practices WHERE id = ?").get(document.practiceId),
    ).toMatchObject({ title: "Pratica da documento" });
    expect(
      database.prepare("SELECT practice_id FROM documents WHERE id = ?").get(document.id),
    ).toMatchObject({ practice_id: document.practiceId });
    expect(
      database
        .prepare("SELECT type, status FROM jobs WHERE document_id = ? ORDER BY type")
        .all(document.id),
    ).toEqual([
      { type: "document.process", status: "queued" },
      { type: "foundation.verify_blob", status: "queued" },
    ]);
  });

  it("non lascia una pratica vuota quando la persistenza del file fallisce", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-ingestion-failure-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const file = new File(["contenuto"], "errore.txt", { type: "text/plain" });
    Object.defineProperty(file, "stream", {
      value: () =>
        new ReadableStream({
          start(controller) {
            controller.error(new Error("SYNTHETIC_UPLOAD_FAILURE"));
          },
        }),
    });

    await expect(
      ingestDocument(database, file, { newPracticeTitle: "Pratica da non lasciare" }, directory),
    ).rejects.toThrow("SYNTHETIC_UPLOAD_FAILURE");
    expect(database.prepare("SELECT count(*) AS count FROM practices").get()).toMatchObject({
      count: 0,
    });
  });

  it("riapre la verifica esaurita quando lo stesso originale viene ricaricato", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-ingestion-repair-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const contents = "contenuto sintetico riparato";
    const document = await ingestDocument(
      database,
      new File([contents], "originale.txt", { type: "text/plain" }),
      { newPracticeTitle: "Pratica da riparare" },
      directory,
    );
    const verification = database
      .prepare("SELECT id FROM jobs WHERE type = ? AND document_id = ?")
      .get("foundation.verify_blob", document.id) as { id: string };

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      expect(claimNextJob(database)).toMatchObject({ id: verification.id, attempts: attempt });
      finishJob(database, verification.id, "BLOB_HASH_MISMATCH");
      if (attempt === 1) {
        await runJobRunnerTick(database);
        expect(
          database
            .prepare("SELECT status, error_code FROM jobs WHERE type = ? AND document_id = ?")
            .get("document.process", document.id),
        ).toEqual({ status: "failed", error_code: "BLOB_VERIFICATION_FAILED" });
      }
      if (attempt < 3) {
        enqueueJob(
          database,
          "foundation.verify_blob",
          { sha256: document.sha256 },
          { practiceId: document.practiceId, documentId: document.id },
        );
      }
    }

    const reloaded = await ingestDocument(
      database,
      new File([contents], "originale.txt", { type: "text/plain" }),
      { practiceId: document.practiceId },
      directory,
    );
    expect(reloaded.id).toBe(document.id);
    expect(
      database
        .prepare("SELECT type, status, attempts FROM jobs WHERE document_id = ? ORDER BY type")
        .all(document.id),
    ).toEqual([
      { type: "document.process", status: "queued", attempts: 0 },
      { type: "foundation.verify_blob", status: "queued", attempts: 0 },
    ]);

    const previousDataDirectory = process.env.SEQUENT_DATA_DIR;
    process.env.SEQUENT_DATA_DIR = directory;
    try {
      await runJobRunnerTick(database);
      await runJobRunnerTick(database);
    } finally {
      if (previousDataDirectory === undefined) delete process.env.SEQUENT_DATA_DIR;
      else process.env.SEQUENT_DATA_DIR = previousDataDirectory;
    }
    expect(
      database
        .prepare("SELECT type, status FROM jobs WHERE document_id = ? ORDER BY type")
        .all(document.id),
    ).toEqual([
      { type: "document.process", status: "completed" },
      { type: "foundation.verify_blob", status: "completed" },
    ]);
  });
});
