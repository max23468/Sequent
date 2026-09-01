import { z } from "zod";
import { evaluateExtractionSafetyBenchmark, type BenchmarkReport } from "./extraction-safety.ts";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const commitSchema = z.string().regex(/^[a-f0-9]{40}$/);
const timestampSchema = z.iso.datetime({ offset: true });
const openingDateSchema = z.iso.date();

export const supportedBrowserTargets = [
  "macos_safari",
  "macos_chrome",
  "windows_chrome",
  "windows_edge",
  "ios_safari",
] as const;

export const realPracticeStages = [
  "dossier_upload",
  "technical_processing",
  "codex_analysis",
  "professional_review",
  "devolution",
  "calculations",
  "checklist",
  "diz_export",
  "successionionline_round_trip",
  "telematic_and_receipts",
  "closure",
] as const;

const browserEvidenceSchema = z.object({
  target: z.enum(supportedBrowserTargets),
  passed: z.boolean(),
  automated: z.boolean(),
  executedAt: timestampSchema,
});

const historicalPracticeSchema = z.object({
  openingDate: openingDateSchema,
  expectedOutcomeSource: z.enum([
    "submitted_declaration_and_professional_corrections",
    "owner_confirmed_complete_diz",
  ]),
  reconstructedEndToEnd: z.boolean(),
  reconciledWithExpectedOutcome: z.boolean(),
  unresolvedCriticalDivergences: z.number().int().nonnegative(),
  criticalRegressions: z.number().int().nonnegative(),
  benchmarkRuns: z.array(z.unknown()).min(1),
});

const qualificationInputSchema = z.object({
  format: z.literal("sequent-go-live-qualification-input"),
  version: z.literal(1),
  candidate: z.object({
    commit: commitSchema,
    version: z.string().regex(/^(?:0\.7\.\d+|1\.0\.0)$/),
    httpsHealthReadback: z.boolean(),
  }),
  historicalPractices: z.array(historicalPracticeSchema).min(5).max(10),
  officialCompliance: z.object({
    commit: commitSchema,
    sourceBundleVerified: z.boolean(),
    catalogCoverageComplete: z.boolean(),
    unresolvedRelevantEntries: z.number().int().nonnegative(),
    syntheticPackageAcceptedByOfficialControl: z.boolean(),
  }),
  browserMatrix: z
    .array(browserEvidenceSchema)
    .length(supportedBrowserTargets.length)
    .refine(
      (items) => new Set(items.map((item) => item.target)).size === supportedBrowserTargets.length,
      "GO_LIVE_BROWSER_TARGETS_DUPLICATED",
    ),
  backupRestore: z.object({
    commit: commitSchema,
    backupVerified: z.boolean(),
    isolatedRestoreVerified: z.boolean(),
    restoredPracticeCount: z.number().int().nonnegative(),
    artifactReadbackVerified: z.boolean(),
  }),
  realPractice: z.object({
    completedStages: z.array(z.enum(realPracticeStages)),
    parallelMethodReconciled: z.boolean(),
    unresolvedCriticalDivergences: z.number().int().nonnegative(),
    officialControlPassed: z.boolean(),
  }),
  ownerApproval: z.object({
    approved: z.boolean(),
    approvedAt: timestampSchema.nullable(),
  }),
});

type GoLiveQualificationInput = z.infer<typeof qualificationInputSchema>;

export interface GoLiveQualificationReport {
  format: "sequent-go-live-qualification";
  version: 1;
  generatedAt: string;
  candidate: {
    commit: string;
    version: string;
  };
  privateInputSha256: string;
  historicalCorpus: {
    practices: number;
    benchmarkRuns: number;
    categories: string[];
    openingYears: number[];
    coversFirstReformYear: boolean;
    reconstructed: number;
    reconciled: number;
    unresolvedCriticalDivergences: number;
    criticalRegressions: number;
    worstNonCriticalPrecision: number;
    inventedSources: number;
    safetyGatePassed: boolean;
  };
  operationalEvidence: {
    officialCompliancePassed: boolean;
    browserTargetsPassed: number;
    browserTargetsRequired: number;
    backupRestorePassed: boolean;
    httpsHealthReadbackPassed: boolean;
    realPracticeStagesPassed: number;
    realPracticeStagesRequired: number;
    realPracticeReconciled: boolean;
  };
  technicalGatePassed: boolean;
  ownerApproved: boolean;
  passed: boolean;
  blockers: string[];
}

function everyCommitMatches(input: GoLiveQualificationInput): boolean {
  return (
    input.officialCompliance.commit === input.candidate.commit &&
    input.backupRestore.commit === input.candidate.commit
  );
}

function benchmarkSummary(practices: GoLiveQualificationInput["historicalPractices"]): {
  reports: BenchmarkReport[];
  categories: string[];
} {
  const reports = practices.flatMap((practice) =>
    practice.benchmarkRuns.map((run) => evaluateExtractionSafetyBenchmark(run)),
  );
  return {
    reports,
    categories: [
      ...new Set(reports.flatMap((report) => report.results.map((result) => result.category))),
    ].sort(),
  };
}

function allRequiredValues<T extends string>(
  actual: readonly T[],
  required: readonly T[],
): boolean {
  const values = new Set(actual);
  return values.size === required.length && required.every((value) => values.has(value));
}

export function evaluateGoLiveQualification(
  rawInput: unknown,
  options: { privateInputSha256: string; generatedAt?: string },
): GoLiveQualificationReport {
  const input = qualificationInputSchema.parse(rawInput);
  const privateInputSha256 = sha256Schema.parse(options.privateInputSha256);
  const { reports, categories } = benchmarkSummary(input.historicalPractices);
  const blockers: string[] = [];
  const years = input.historicalPractices.map((practice) =>
    Number(practice.openingDate.slice(0, 4)),
  );
  const openingYears = [...new Set(years)].sort((left, right) => left - right);
  const coversFirstReformYear = years.includes(2025);
  const reconstructed = input.historicalPractices.filter(
    (practice) => practice.reconstructedEndToEnd,
  ).length;
  const reconciled = input.historicalPractices.filter(
    (practice) => practice.reconciledWithExpectedOutcome,
  ).length;
  const unresolvedCriticalDivergences = input.historicalPractices.reduce(
    (total, practice) => total + practice.unresolvedCriticalDivergences,
    0,
  );
  const criticalRegressions = input.historicalPractices.reduce(
    (total, practice) => total + practice.criticalRegressions,
    0,
  );
  const inventedSources = reports.reduce((total, report) => total + report.inventedSources, 0);
  const worstNonCriticalPrecision = Math.min(
    ...reports.map((report) => report.nonCriticalPrecision),
  );
  const safetyGatePassed = reports.every((report) => report.passedSafetyGate);
  const officialCompliancePassed =
    input.officialCompliance.sourceBundleVerified &&
    input.officialCompliance.catalogCoverageComplete &&
    input.officialCompliance.unresolvedRelevantEntries === 0 &&
    input.officialCompliance.syntheticPackageAcceptedByOfficialControl;
  const browserTargetsPassed = input.browserMatrix.filter((evidence) => evidence.passed).length;
  const browserMatrixPassed =
    allRequiredValues(
      input.browserMatrix.map((evidence) => evidence.target),
      supportedBrowserTargets,
    ) &&
    input.browserMatrix.every((evidence) => evidence.passed) &&
    input.browserMatrix.some((evidence) => !evidence.automated);
  const backupRestorePassed =
    input.backupRestore.backupVerified &&
    input.backupRestore.isolatedRestoreVerified &&
    input.backupRestore.restoredPracticeCount >= input.historicalPractices.length &&
    input.backupRestore.artifactReadbackVerified;
  const completedRealPracticeStages = [...new Set(input.realPractice.completedStages)];
  const realPracticeStagesComplete = allRequiredValues(
    completedRealPracticeStages,
    realPracticeStages,
  );
  const realPracticeReconciled =
    realPracticeStagesComplete &&
    input.realPractice.parallelMethodReconciled &&
    input.realPractice.unresolvedCriticalDivergences === 0 &&
    input.realPractice.officialControlPassed;
  const ownerApproved = input.ownerApproval.approved && input.ownerApproval.approvedAt !== null;

  if (!coversFirstReformYear) blockers.push("HISTORICAL_CORPUS_FIRST_REFORM_YEAR_MISSING");
  if (reconstructed !== input.historicalPractices.length)
    blockers.push("HISTORICAL_PRACTICES_NOT_RECONSTRUCTED");
  if (reconciled !== input.historicalPractices.length)
    blockers.push("HISTORICAL_PRACTICES_NOT_RECONCILED");
  if (unresolvedCriticalDivergences > 0) blockers.push("HISTORICAL_CRITICAL_DIVERGENCES_OPEN");
  if (criticalRegressions > 0) blockers.push("HISTORICAL_CRITICAL_REGRESSIONS");
  if (!safetyGatePassed) blockers.push("EXTRACTION_SAFETY_GATE_FAILED");
  if (!everyCommitMatches(input)) blockers.push("EVIDENCE_COMMIT_MISMATCH");
  if (!officialCompliancePassed) blockers.push("OFFICIAL_COMPLIANCE_NOT_QUALIFIED");
  if (!browserMatrixPassed) blockers.push("BROWSER_MATRIX_INCOMPLETE");
  if (!backupRestorePassed) blockers.push("BACKUP_RESTORE_NOT_QUALIFIED");
  if (!input.candidate.httpsHealthReadback) blockers.push("HTTPS_HEALTH_READBACK_MISSING");
  if (!realPracticeReconciled) blockers.push("REAL_PRACTICE_NOT_RECONCILED");

  const technicalGatePassed = blockers.length === 0;
  if (!ownerApproved) blockers.push("OWNER_APPROVAL_MISSING");

  return {
    format: "sequent-go-live-qualification",
    version: 1,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    candidate: input.candidate,
    privateInputSha256,
    historicalCorpus: {
      practices: input.historicalPractices.length,
      benchmarkRuns: reports.length,
      categories,
      openingYears,
      coversFirstReformYear,
      reconstructed,
      reconciled,
      unresolvedCriticalDivergences,
      criticalRegressions,
      worstNonCriticalPrecision,
      inventedSources,
      safetyGatePassed,
    },
    operationalEvidence: {
      officialCompliancePassed,
      browserTargetsPassed,
      browserTargetsRequired: supportedBrowserTargets.length,
      backupRestorePassed,
      httpsHealthReadbackPassed: input.candidate.httpsHealthReadback,
      realPracticeStagesPassed: completedRealPracticeStages.length,
      realPracticeStagesRequired: realPracticeStages.length,
      realPracticeReconciled,
    },
    technicalGatePassed,
    ownerApproved,
    passed: technicalGatePassed && ownerApproved,
    blockers,
  };
}
