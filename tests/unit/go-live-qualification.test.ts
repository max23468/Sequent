import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateGoLiveQualification } from "../../src/lib/benchmark/go-live-qualification.ts";

const commit = "a".repeat(40);
const privateInputSha256 = "b".repeat(64);

function validInput(): Record<string, unknown> {
  return {
    format: "sequent-go-live-qualification-input",
    version: 2,
    candidate: {
      commit,
      version: "1.0.0",
      httpsHealthReadback: true,
      httpsHealthReadbackAt: "2026-09-01T14:30:00+02:00",
    },
    dizCorpus: {
      commit,
      qualifiedAt: "2026-09-01T14:10:00+02:00",
      files: 5,
      uniqueFiles: 5,
      qualifiedSamples: 5,
      mappedFields: 897,
      openingDates: ["2006-10-03", "2021-04-18", "2024-06-01", "2025-01-15", "2025-09-10"],
      readbackVerified: true,
      ownerConfirmedComplete: true,
      unresolvedCriticalDivergences: 0,
    },
    officialCompliance: {
      commit,
      qualifiedAt: "2026-09-01T14:20:00+02:00",
      sourceBundleVerified: true,
      catalogCoverageComplete: true,
      unresolvedRelevantEntries: 0,
      syntheticPackageAcceptedByOfficialControl: true,
    },
    backupRestore: {
      commit,
      qualifiedAt: "2026-09-01T14:25:00+02:00",
      backupVerified: true,
      isolatedRestoreVerified: true,
      restoredPracticeCount: 5,
      artifactReadbackVerified: true,
    },
    ownerApproval: {
      approved: true,
      approvedAt: "2026-09-01T15:00:00+02:00",
    },
  };
}

describe("qualifica finale", () => {
  it("chiude con corpus DIZ, prove operative e approvazione", () => {
    const report = evaluateGoLiveQualification(validInput(), {
      privateInputSha256,
      generatedAt: "2026-09-01T15:01:00+02:00",
    });
    expect(report.passed).toBe(true);
    expect(report.technicalGatePassed).toBe(true);
    expect(report.dizCorpus.files).toBe(5);
    expect(report.dizCorpus.qualifiedSamples).toBe(5);
    expect(report.dizCorpus.mappedFields).toBe(897);
    expect(report.dizCorpus.openingYears).toEqual([2006, 2021, 2024, 2025]);
    expect(report.blockers).toEqual([]);
  });

  it("deriva dalle date private la copertura del primo anno", () => {
    const input = validInput();
    input.dizCorpus = {
      ...(input.dizCorpus as Record<string, unknown>),
      openingDates: ["2006-10-03", "2021-04-18", "2022-06-01", "2023-01-15", "2024-09-10"],
    };
    const report = evaluateGoLiveQualification(input, { privateInputSha256 });
    expect(report.dizCorpus.coversFirstReformYear).toBe(false);
    expect(report.blockers).toContain("DIZ_CORPUS_NOT_QUALIFIED");
  });

  it("blocca corpus incompleto e approvazione mancante", () => {
    const input = validInput();
    input.dizCorpus = {
      ...(input.dizCorpus as Record<string, unknown>),
      readbackVerified: false,
      unresolvedCriticalDivergences: 1,
    };
    input.ownerApproval = { approved: false, approvedAt: null };
    const report = evaluateGoLiveQualification(input, { privateInputSha256 });
    expect(report.technicalGatePassed).toBe(false);
    expect(report.passed).toBe(false);
    expect(report.blockers).toEqual(
      expect.arrayContaining(["DIZ_CORPUS_NOT_QUALIFIED", "OWNER_APPROVAL_NOT_FINAL"]),
    );
  });

  it("rifiuta prove prodotte su commit diversi", () => {
    const input = validInput();
    (input.backupRestore as Record<string, unknown>).commit = "c".repeat(40);
    const report = evaluateGoLiveQualification(input, { privateInputSha256 });
    expect(report.technicalGatePassed).toBe(false);
    expect(report.blockers).toContain("EVIDENCE_COMMIT_MISMATCH");
  });

  it("richiede la release stabile", () => {
    const input = validInput();
    (input.candidate as Record<string, unknown>).version = "0.7.2";
    expect(() => evaluateGoLiveQualification(input, { privateInputSha256 })).toThrow();
  });

  it("accetta soltanto un’approvazione successiva alle prove tecniche", () => {
    const input = validInput();
    input.ownerApproval = { approved: true, approvedAt: "2026-09-01T14:29:59+02:00" };
    const report = evaluateGoLiveQualification(input, { privateInputSha256 });
    expect(report.technicalGatePassed).toBe(true);
    expect(report.ownerApproved).toBe(false);
    expect(report.blockers).toContain("OWNER_APPROVAL_NOT_FINAL");
  });

  it("scrive soltanto un report privato e sanitizzato", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sequent-go-live-test-"));
    const inputPath = join(directory, "input.json");
    const outputPath = join(directory, "report.json");
    try {
      await writeFile(inputPath, `${JSON.stringify(validInput())}\n`, { mode: 0o600 });
      const stdout = execFileSync(
        process.execPath,
        ["scripts/admin/qualify-go-live.ts", "--input", inputPath, "--output", outputPath],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: { ...process.env, SEQUENT_COMMIT_SHA: commit },
        },
      );
      const report = JSON.parse(await readFile(outputPath, "utf8"));
      expect(stdout).toBe("Qualifica go-live: SUPERATA; blocker: 0.\n");
      expect(report.passed).toBe(true);
      expect(report.dizCorpus).not.toHaveProperty("samples");
      expect((await stat(outputPath)).mode & 0o777).toBe(0o600);
      expect((await stat(directory)).mode & 0o777).toBe(0o700);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
