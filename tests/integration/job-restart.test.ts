import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("recupero job dopo il riavvio del processo", () => {
  it("riprende e completa un job persistito da un processo precedente", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-job-restart-"));
    directories.push(directory);
    const jobId = execFileSync(
      process.execPath,
      ["tests/fixtures/job-restart-process.ts", "interrupt", directory],
      { encoding: "utf8" },
    ).trim();
    const jobIdPath = join(directory, "job-id.txt");
    writeFileSync(jobIdPath, jobId);

    const resumed = JSON.parse(
      execFileSync(
        process.execPath,
        ["tests/fixtures/job-restart-process.ts", "resume", directory, jobIdPath],
        { encoding: "utf8" },
      ),
    ) as { status: string; attempts: number; error_code: string | null };

    expect(resumed).toEqual({ status: "completed", attempts: 2, error_code: null });
  });
});
