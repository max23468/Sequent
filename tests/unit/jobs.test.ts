import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, openDatabase } from "../../src/lib/server/database.ts";
import {
  claimNextJob,
  enqueueJob,
  finishJob,
  recoverInterruptedJobs,
} from "../../src/lib/server/jobs.ts";

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
});
