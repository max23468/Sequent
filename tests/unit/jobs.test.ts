import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { closeDatabase, openDatabase } from "../../src/lib/server/database.ts";
import { runJobRunnerTick } from "../../src/lib/server/job-runner.ts";
import {
  cancelQueuedJob,
  claimNextJob,
  enqueueJob,
  finishJob,
  listFailedBlobVerifications,
  recoverInterruptedJobs,
  retryJob,
} from "../../src/lib/server/jobs.ts";
import { createPractice } from "../../src/lib/server/practices.ts";
import { ingestDocument } from "../../src/lib/server/document-ingestion.ts";
import { DEPLOYMENT_MAINTENANCE_MARKER } from "../../src/lib/server/deployment-maintenance.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    closeDatabase(directory);
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("coda persistente", () => {
  it("non reclama job finché il deploy mantiene il marker", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-job-maintenance-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const job = enqueueJob(database, "foundation.test", { input: "maintenance" });
    const marker = join(directory, DEPLOYMENT_MAINTENANCE_MARKER);
    writeFileSync(marker, "");

    await runJobRunnerTick(database, directory);
    expect(database.prepare("SELECT status FROM jobs WHERE id = ?").get(job.id)).toEqual({
      status: "queued",
    });

    rmSync(marker);
    await runJobRunnerTick(database, directory);
    expect(
      database.prepare("SELECT status, error_code FROM jobs WHERE id = ?").get(job.id),
    ).toEqual({
      status: "failed",
      error_code: "JOB_TYPE_UNSUPPORTED",
    });
  });

  it("ritenta un job dopo una contesa SQLite senza terminare il runner", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-job-busy-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const job = enqueueJob(database, "foundation.test", { input: "busy" });
    database.pragma("busy_timeout = 0");

    const locker = new Database(join(directory, "sequent.sqlite"));
    locker.pragma("journal_mode = WAL");
    locker.exec("BEGIN IMMEDIATE");
    try {
      await expect(runJobRunnerTick(database)).resolves.toBeUndefined();
      expect(database.prepare("SELECT status FROM jobs WHERE id = ?").get(job.id)).toEqual({
        status: "queued",
      });
    } finally {
      locker.exec("ROLLBACK");
      locker.close();
    }

    await expect(runJobRunnerTick(database)).resolves.toBeUndefined();
    expect(
      database.prepare("SELECT status, error_code FROM jobs WHERE id = ?").get(job.id),
    ).toEqual({
      status: "failed",
      error_code: "JOB_TYPE_UNSUPPORTED",
    });
  });

  it("non elabora un documento quando la verifica del blob è fallita", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-job-invalid-blob-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Pratica con blob non valido");
    const document = await ingestDocument(
      database,
      new File(["originale sintetico"], "originale.txt", { type: "text/plain" }),
      { practiceId: practice.id },
      directory,
    );
    database
      .prepare(
        `UPDATE jobs SET status = 'failed', error_code = 'BLOB_HASH_MISMATCH'
         WHERE type = 'foundation.verify_blob' AND document_id = ?`,
      )
      .run(document.id);

    await runJobRunnerTick(database);

    expect(
      database
        .prepare("SELECT status, error_code FROM jobs WHERE type = ? AND document_id = ?")
        .get("document.process", document.id),
    ).toEqual({ status: "failed", error_code: "BLOB_VERIFICATION_FAILED" });
    expect(database.prepare("SELECT status FROM documents WHERE id = ?").get(document.id)).toEqual({
      status: "received",
    });
  });

  it("annulla un job in coda e consente il retry manuale", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-job-cancel-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Pratica annullamento");
    const job = enqueueJob(
      database,
      "document.process",
      { input: "cancel" },
      { practiceId: practice.id },
    );

    expect(cancelQueuedJob(database, job.id, practice.id)).toBe(true);
    expect(claimNextJob(database)).toBeNull();
    expect(retryJob(database, job.id, practice.id)).toBe(true);
    expect(claimNextJob(database)).toMatchObject({ id: job.id, status: "running" });
  });

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

  it("chiude come fallita una run Codex rimasta attiva al riavvio", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-codex-run-restart-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Pratica Codex interrotta");
    const now = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO codex_runs(
           id, practice_id, snapshot_hash, prompt_version, model, effort,
           status, created_at, updated_at
         ) VALUES ('run-interrotta', ?, 'hash', 'prompt', 'model', 'high', 'running', ?, ?)`,
      )
      .run(practice.id, now, now);

    recoverInterruptedJobs(database);

    expect(database.prepare("SELECT status, error_code FROM codex_runs").get()).toEqual({
      status: "failed",
      error_code: "PROCESS_RESTART",
    });
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
    database
      .prepare(
        "UPDATE jobs SET status = 'cancelled' WHERE type = 'document.process' AND document_id = ?",
      )
      .run(document.id);
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
