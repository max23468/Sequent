import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, openDatabase } from "../../src/lib/server/database.ts";
import {
  claimNextJob,
  enqueueJob,
  finishJob,
  listFailedBlobVerifications,
  recoverInterruptedJobs,
} from "../../src/lib/server/jobs.ts";
import { createPractice } from "../../src/lib/server/practices.ts";
import { ingestDocument } from "../../src/lib/server/document-ingestion.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    closeDatabase(directory);
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("coda persistente", () => {
  it("riaccoda un job di verifica fallito soltanto entro il limite dei tentativi", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-job-retry-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const parameters = { sha256: "digest-sintetico" };

    const first = enqueueJob(database, "foundation.verify_blob", parameters);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const claimed = claimNextJob(database);
      expect(claimed).toMatchObject({ id: first.id, status: "running", attempts: attempt });
      finishJob(database, first.id, "READ_TRANSIENT");
      const duplicate = enqueueJob(database, "foundation.verify_blob", parameters);
      expect(duplicate.id).toBe(first.id);
      expect(duplicate.status).toBe(attempt < 3 ? "queued" : "failed");
      expect(duplicate.errorCode).toBe(attempt < 3 ? null : "READ_TRANSIENT");
    }
  });

  it("deduplica i job equivalenti e recupera quello interrotto al riavvio", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-job-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const first = enqueueJob(database, "foundation.test", { input: "same" });
    const duplicate = enqueueJob(database, "foundation.test", { input: "same" });
    expect(duplicate.id).toBe(first.id);
    expect(claimNextJob(database)?.status).toBe("running");
    expect(recoverInterruptedJobs(database)).toBe(1);
    expect(claimNextJob(database)?.attempts).toBe(2);
  });

  it("rende visibile come fallito un job interrotto dopo l'ultimo tentativo", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-job-exhausted-restart-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Pratica interrotta");
    const document = await ingestDocument(
      database,
      new File(["originale sintetico"], "interrotto.pdf", { type: "application/pdf" }),
      { practiceId: practice.id },
      directory,
    );
    const job = database.prepare("SELECT id FROM jobs WHERE document_id = ?").get(document.id) as {
      id: string;
    };
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      expect(claimNextJob(database)?.attempts).toBe(attempt);
      if (attempt < 3) {
        finishJob(database, job.id, "READ_TRANSIENT");
        enqueueJob(
          database,
          "foundation.verify_blob",
          { sha256: document.sha256 },
          { practiceId: practice.id, documentId: document.id },
        );
      }
    }

    expect(recoverInterruptedJobs(database)).toBe(1);
    expect(claimNextJob(database)).toBeNull();
    expect(listFailedBlobVerifications(database, practice.id)).toEqual([
      expect.objectContaining({
        jobId: job.id,
        attempts: 3,
        errorCode: "PROCESS_RESTART",
      }),
    ]);
  });

  it("espone alla Dashboard e al workspace le verifiche dei blob fallite", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-job-visible-failure-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Pratica con verifica fallita");
    const document = await ingestDocument(
      database,
      new File(["originale sintetico"], "originale.pdf", { type: "application/pdf" }),
      { practiceId: practice.id },
      directory,
    );
    const job = database.prepare("SELECT id FROM jobs WHERE document_id = ?").get(document.id) as {
      id: string;
    };
    expect(claimNextJob(database)?.id).toBe(job.id);
    finishJob(database, job.id, "BLOB_HASH_MISMATCH");

    expect(listFailedBlobVerifications(database)).toEqual([
      expect.objectContaining({
        jobId: job.id,
        practiceId: practice.id,
        practiceTitle: "Pratica con verifica fallita",
        documentId: document.id,
        documentName: "originale.pdf",
        errorCode: "BLOB_HASH_MISMATCH",
      }),
    ]);
    expect(listFailedBlobVerifications(database, practice.id)).toHaveLength(1);
    expect(listFailedBlobVerifications(database, "altra-pratica")).toEqual([]);
  });
});
