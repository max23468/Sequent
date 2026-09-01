import { z } from "zod";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const commitSchema = z.string().regex(/^[a-f0-9]{40}$/);
const timestampSchema = z.iso.datetime({ offset: true });
const openingDateSchema = z.iso.date();

const qualificationInputSchema = z.object({
  format: z.literal("sequent-go-live-qualification-input"),
  version: z.literal(2),
  candidate: z.object({
    commit: commitSchema,
    version: z.literal("1.0.0"),
    httpsHealthReadback: z.boolean(),
    httpsHealthReadbackAt: timestampSchema,
  }),
  dizCorpus: z.object({
    commit: commitSchema,
    qualifiedAt: timestampSchema,
    files: z.literal(5),
    uniqueFiles: z.literal(5),
    qualifiedSamples: z.literal(5),
    mappedFields: z.number().int().positive(),
    openingDates: z.array(openingDateSchema).length(5),
    readbackVerified: z.boolean(),
    ownerConfirmedComplete: z.boolean(),
    unresolvedCriticalDivergences: z.number().int().nonnegative(),
  }),
  officialCompliance: z.object({
    commit: commitSchema,
    qualifiedAt: timestampSchema,
    sourceBundleVerified: z.boolean(),
    catalogCoverageComplete: z.boolean(),
    unresolvedRelevantEntries: z.number().int().nonnegative(),
    syntheticPackageAcceptedByOfficialControl: z.boolean(),
  }),
  backupRestore: z.object({
    commit: commitSchema,
    qualifiedAt: timestampSchema,
    backupVerified: z.boolean(),
    isolatedRestoreVerified: z.boolean(),
    restoredPracticeCount: z.number().int().nonnegative(),
    artifactReadbackVerified: z.boolean(),
  }),
  ownerApproval: z.object({
    approved: z.boolean(),
    approvedAt: timestampSchema.nullable(),
  }),
});

type GoLiveQualificationInput = z.infer<typeof qualificationInputSchema>;

export interface GoLiveQualificationReport {
  format: "sequent-go-live-qualification";
  version: 2;
  generatedAt: string;
  candidate: { commit: string; version: "1.0.0" };
  privateInputSha256: string;
  dizCorpus: {
    files: number;
    uniqueFiles: number;
    qualifiedSamples: number;
    mappedFields: number;
    openingYears: number[];
    readbackVerified: boolean;
    ownerConfirmedComplete: boolean;
    coversFirstReformYear: boolean;
    unresolvedCriticalDivergences: number;
  };
  operationalEvidence: {
    officialCompliancePassed: boolean;
    backupRestorePassed: boolean;
    httpsHealthReadbackPassed: boolean;
  };
  technicalGatePassed: boolean;
  ownerApproved: boolean;
  passed: boolean;
  blockers: string[];
}

function everyCommitMatches(input: GoLiveQualificationInput): boolean {
  return (
    input.dizCorpus.commit === input.candidate.commit &&
    input.officialCompliance.commit === input.candidate.commit &&
    input.backupRestore.commit === input.candidate.commit
  );
}

export function evaluateGoLiveQualification(
  rawInput: unknown,
  options: { privateInputSha256: string; generatedAt?: string },
): GoLiveQualificationReport {
  const input = qualificationInputSchema.parse(rawInput);
  const privateInputSha256 = sha256Schema.parse(options.privateInputSha256);
  const blockers: string[] = [];
  const openingYears = [
    ...new Set(input.dizCorpus.openingDates.map((date) => Number(date.slice(0, 4)))),
  ].sort((left, right) => left - right);
  const coversFirstReformYear = openingYears.includes(2025);
  const corpusPassed =
    input.dizCorpus.readbackVerified &&
    input.dizCorpus.ownerConfirmedComplete &&
    coversFirstReformYear &&
    input.dizCorpus.unresolvedCriticalDivergences === 0;
  const officialCompliancePassed =
    input.officialCompliance.sourceBundleVerified &&
    input.officialCompliance.catalogCoverageComplete &&
    input.officialCompliance.unresolvedRelevantEntries === 0 &&
    input.officialCompliance.syntheticPackageAcceptedByOfficialControl;
  const backupRestorePassed =
    input.backupRestore.backupVerified &&
    input.backupRestore.isolatedRestoreVerified &&
    input.backupRestore.restoredPracticeCount >= input.dizCorpus.files &&
    input.backupRestore.artifactReadbackVerified;
  const latestTechnicalEvidenceAt = Math.max(
    Date.parse(input.candidate.httpsHealthReadbackAt),
    Date.parse(input.dizCorpus.qualifiedAt),
    Date.parse(input.officialCompliance.qualifiedAt),
    Date.parse(input.backupRestore.qualifiedAt),
  );
  const ownerApproved =
    input.ownerApproval.approved &&
    input.ownerApproval.approvedAt !== null &&
    Date.parse(input.ownerApproval.approvedAt) >= latestTechnicalEvidenceAt;

  if (!corpusPassed) blockers.push("DIZ_CORPUS_NOT_QUALIFIED");
  if (!everyCommitMatches(input)) blockers.push("EVIDENCE_COMMIT_MISMATCH");
  if (!officialCompliancePassed) blockers.push("OFFICIAL_COMPLIANCE_NOT_QUALIFIED");
  if (!backupRestorePassed) blockers.push("BACKUP_RESTORE_NOT_QUALIFIED");
  if (!input.candidate.httpsHealthReadback) blockers.push("HTTPS_HEALTH_READBACK_MISSING");

  const technicalGatePassed = blockers.length === 0;
  if (!ownerApproved) blockers.push("OWNER_APPROVAL_NOT_FINAL");

  return {
    format: "sequent-go-live-qualification",
    version: 2,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    candidate: input.candidate,
    privateInputSha256,
    dizCorpus: {
      files: input.dizCorpus.files,
      uniqueFiles: input.dizCorpus.uniqueFiles,
      qualifiedSamples: input.dizCorpus.qualifiedSamples,
      mappedFields: input.dizCorpus.mappedFields,
      openingYears,
      readbackVerified: input.dizCorpus.readbackVerified,
      ownerConfirmedComplete: input.dizCorpus.ownerConfirmedComplete,
      coversFirstReformYear,
      unresolvedCriticalDivergences: input.dizCorpus.unresolvedCriticalDivergences,
    },
    operationalEvidence: {
      officialCompliancePassed,
      backupRestorePassed,
      httpsHealthReadbackPassed: input.candidate.httpsHealthReadback,
    },
    technicalGatePassed,
    ownerApproved,
    passed: technicalGatePassed && ownerApproved,
    blockers,
  };
}
