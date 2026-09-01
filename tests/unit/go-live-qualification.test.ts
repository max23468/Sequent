import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateGoLiveQualification,
  realPracticeStages,
  supportedBrowserTargets,
} from "../../src/lib/benchmark/go-live-qualification.ts";

const commit = "a".repeat(40);
const privateInputSha256 = "b".repeat(64);

function benchmarkRun(category: string, suffix: number): unknown {
  return {
    corpusId: `synthetic-${suffix}`,
    corpusHash: String(suffix).padStart(64, "0"),
    cases: [
      {
        id: `case-${suffix}`,
        category,
        knownDocumentIds: [`document-${suffix}`],
        expected: [
          {
            key: `field-${suffix}`,
            value: `value-${suffix}`,
            documentId: `document-${suffix}`,
            pageNumber: 1,
            sourceText: `Controlled source value-${suffix}`,
            critical: suffix % 2 === 0,
          },
        ],
        observed: [
          {
            key: `field-${suffix}`,
            value: `value-${suffix}`,
            documentId: `document-${suffix}`,
            pageNumber: 1,
            sourceExcerpt: `source value-${suffix}`,
            reviewStatus: "confirmed",
          },
        ],
      },
    ],
  };
}

function validInput(): Record<string, unknown> {
  const dates = ["2006-10-03", "2021-04-18", "2024-06-01", "2025-01-15", "2025-09-10"];
  const categories = ["pdf_native", "pdf_scanned", "identity_document", "bank_certificate", "diz"];
  return {
    format: "sequent-go-live-qualification-input",
    version: 1,
    candidate: { commit, version: "0.7.0", httpsHealthReadback: true },
    historicalPractices: dates.map((openingDate, index) => ({
      openingDate,
      expectedOutcomeSource:
        index === 0
          ? "owner_confirmed_complete_diz"
          : "submitted_declaration_and_professional_corrections",
      reconstructedEndToEnd: true,
      reconciledWithExpectedOutcome: true,
      unresolvedCriticalDivergences: 0,
      criticalRegressions: 0,
      benchmarkRuns: [benchmarkRun(categories[index]!, index + 1)],
    })),
    officialCompliance: {
      commit,
      sourceBundleVerified: true,
      catalogCoverageComplete: true,
      unresolvedRelevantEntries: 0,
      syntheticPackageAcceptedByOfficialControl: true,
    },
    browserMatrix: supportedBrowserTargets.map((target, index) => ({
      target,
      passed: true,
      automated: index !== 0,
      executedAt: "2026-09-01T10:00:00+02:00",
    })),
    backupRestore: {
      commit,
      backupVerified: true,
      isolatedRestoreVerified: true,
      restoredPracticeCount: 5,
      artifactReadbackVerified: true,
    },
    realPractice: {
      completedStages: realPracticeStages,
      parallelMethodReconciled: true,
      unresolvedCriticalDivergences: 0,
      officialControlPassed: true,
    },
    ownerApproval: {
      approved: true,
      approvedAt: "2026-09-01T11:00:00+02:00",
    },
  };
}

describe("qualifica finale", () => {
  it("chiude soltanto con corpus, prove operative, pratica reale e approvazione", () => {
    const report = evaluateGoLiveQualification(validInput(), {
      privateInputSha256,
      generatedAt: "2026-09-01T12:00:00+02:00",
    });
    expect(report.passed).toBe(true);
    expect(report.technicalGatePassed).toBe(true);
    expect(report.historicalCorpus.practices).toBe(5);
    expect(report.historicalCorpus.benchmarkRuns).toBe(5);
    expect(report.historicalCorpus.openingYears).toEqual([2006, 2021, 2024, 2025]);
    expect(report.historicalCorpus.inventedSources).toBe(0);
    expect(report.blockers).toEqual([]);
  });

  it("blocca il corpus senza il 2025, la riconciliazione reale e l’approvazione mancanti", () => {
    const input = validInput();
    const practices = input.historicalPractices as Array<Record<string, unknown>>;
    for (const [index, practice] of practices.entries()) {
      practice.openingDate = `${2020 + index}-06-01`;
    }
    input.realPractice = {
      completedStages: realPracticeStages.slice(0, -1),
      parallelMethodReconciled: false,
      unresolvedCriticalDivergences: 1,
      officialControlPassed: false,
    };
    input.ownerApproval = { approved: false, approvedAt: null };
    const report = evaluateGoLiveQualification(input, { privateInputSha256 });
    expect(report.technicalGatePassed).toBe(false);
    expect(report.passed).toBe(false);
    expect(report.blockers).toEqual(
      expect.arrayContaining([
        "HISTORICAL_CORPUS_FIRST_REFORM_YEAR_MISSING",
        "REAL_PRACTICE_NOT_RECONCILED",
        "OWNER_APPROVAL_MISSING",
      ]),
    );
  });

  it("rifiuta prove prodotte su commit diversi", () => {
    const input = validInput();
    (input.backupRestore as Record<string, unknown>).commit = "c".repeat(40);
    const report = evaluateGoLiveQualification(input, { privateInputSha256 });
    expect(report.technicalGatePassed).toBe(false);
    expect(report.blockers).toContain("EVIDENCE_COMMIT_MISMATCH");
  });

  it("richiede almeno un ciclo browser manuale", () => {
    const input = validInput();
    input.browserMatrix = (input.browserMatrix as Array<Record<string, unknown>>).map(
      (evidence) => ({ ...evidence, automated: true }),
    );
    const report = evaluateGoLiveQualification(input, { privateInputSha256 });
    expect(report.technicalGatePassed).toBe(false);
    expect(report.blockers).toContain("BROWSER_MATRIX_INCOMPLETE");
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
      expect(report.historicalCorpus).not.toHaveProperty("results");
      expect((await stat(outputPath)).mode & 0o777).toBe(0o600);
      expect((await stat(directory)).mode & 0o777).toBe(0o700);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
