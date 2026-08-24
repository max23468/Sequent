import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, openDatabase } from "../../src/lib/server/database.ts";
import { claimNextJob, enqueueJob, recoverInterruptedJobs } from "../../src/lib/server/jobs.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    closeDatabase(directory);
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("coda persistente", () => {
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
