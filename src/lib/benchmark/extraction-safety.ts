import { z } from "zod";

const benchmarkCategories = [
  "pdf_native",
  "pdf_scanned",
  "photograph",
  "xml",
  "spreadsheet",
  "identity_document",
  "cadastral_record",
  "bank_certificate",
  "will",
  "liability",
  "diz",
] as const;

const expectedFieldSchema = z.object({
  key: z.string().min(1),
  value: z.string().nullable(),
  documentId: z.string().min(1),
  pageNumber: z.number().int().positive().nullable(),
  sourceText: z.string().min(1),
  critical: z.boolean(),
});

const observedFieldSchema = z.object({
  key: z.string().min(1),
  value: z.string().nullable(),
  documentId: z.string().min(1),
  pageNumber: z.number().int().positive().nullable(),
  sourceExcerpt: z.string().nullable(),
  reviewStatus: z.enum(["pending", "confirmed", "edited", "rejected", "ignored"]),
});

const expectedConflictSchema = z.object({
  key: z.string().min(1),
  sources: z
    .array(
      z.object({
        documentId: z.string().min(1),
        pageNumber: z.number().int().positive(),
        value: z.string(),
        sourceText: z.string().min(1),
      }),
    )
    .min(2),
  critical: z.boolean(),
});

const observedConflictSchema = z.object({
  key: z.string().min(1),
  sources: z
    .array(
      z.object({
        documentId: z.string().min(1),
        pageNumber: z.number().int().positive(),
        value: z.string(),
        sourceExcerpt: z.string().min(1),
      }),
    )
    .min(2),
  reviewStatus: z.enum(["pending", "confirmed", "edited", "rejected", "ignored"]),
});

function hasUniqueKeys(items: Array<{ key: string }>): boolean {
  return new Set(items.map((item) => item.key)).size === items.length;
}

const caseSchema = z.object({
  id: z.string().min(1),
  category: z.enum(benchmarkCategories),
  knownDocumentIds: z.array(z.string().min(1)).min(1),
  expected: z.array(expectedFieldSchema).refine(hasUniqueKeys, "EXPECTED_KEYS_DUPLICATED"),
  observed: z.array(observedFieldSchema).refine(hasUniqueKeys, "OBSERVED_KEYS_DUPLICATED"),
  expectedConflicts: z
    .array(expectedConflictSchema)
    .refine(hasUniqueKeys, "EXPECTED_CONFLICT_KEYS_DUPLICATED")
    .default([]),
  observedConflicts: z
    .array(observedConflictSchema)
    .refine(hasUniqueKeys, "OBSERVED_CONFLICT_KEYS_DUPLICATED")
    .default([]),
});

const benchmarkDatasetSchema = z.object({
  corpusId: z.string().min(1),
  corpusHash: z.string().regex(/^[a-f0-9]{64}$/),
  cases: z.array(caseSchema).min(1),
});

type BenchmarkOutcome =
  | "correct_source"
  | "correct_incomplete_source"
  | "wrong"
  | "not_found"
  | "correctly_pending"
  | "conflict_detected"
  | "conflict_ignored"
  | "invented"
  | "invented_source";

export interface BenchmarkReport {
  corpusId: string;
  corpusHash: string;
  totals: Record<BenchmarkOutcome, number>;
  criticalSilentErrors: number;
  inventedSources: number;
  nonCriticalPrecision: number;
  passedSafetyGate: boolean;
  results: Array<{
    caseId: string;
    category: (typeof benchmarkCategories)[number];
    key: string;
    outcome: BenchmarkOutcome;
    critical: boolean;
  }>;
}

const emptyTotals = (): Record<BenchmarkOutcome, number> => ({
  correct_source: 0,
  correct_incomplete_source: 0,
  wrong: 0,
  not_found: 0,
  correctly_pending: 0,
  conflict_detected: 0,
  conflict_ignored: 0,
  invented: 0,
  invented_source: 0,
});

function normalizeEvidenceText(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

function evidenceExcerptMatches(sourceText: string, sourceExcerpt: string): boolean {
  const expectedSource = normalizeEvidenceText(sourceText);
  const observedExcerpt = normalizeEvidenceText(sourceExcerpt);
  return (
    expectedSource.length > 0 &&
    observedExcerpt.length > 0 &&
    expectedSource.includes(observedExcerpt)
  );
}

function sameConflictSources(
  expected: z.infer<typeof expectedConflictSchema>["sources"],
  observed: z.infer<typeof observedConflictSchema>["sources"],
): boolean {
  if (expected.length !== observed.length) return false;
  const used = new Set<number>();
  return expected.every((expectedSource) => {
    const index = observed.findIndex((observedSource, observedIndex) => {
      if (used.has(observedIndex)) return false;
      return (
        observedSource.documentId === expectedSource.documentId &&
        observedSource.pageNumber === expectedSource.pageNumber &&
        observedSource.value === expectedSource.value &&
        evidenceExcerptMatches(expectedSource.sourceText, observedSource.sourceExcerpt)
      );
    });
    if (index < 0) return false;
    used.add(index);
    return true;
  });
}

export function evaluateExtractionSafetyBenchmark(input: unknown): BenchmarkReport {
  const dataset = benchmarkDatasetSchema.parse(input);
  const totals = emptyTotals();
  const results: BenchmarkReport["results"] = [];
  let criticalSilentErrors = 0;
  let nonCriticalCorrect = 0;
  let nonCriticalObserved = 0;

  for (const fixture of dataset.cases) {
    const expectedByKey = new Map(fixture.expected.map((field) => [field.key, field]));
    const observedByKey = new Map(fixture.observed.map((field) => [field.key, field]));
    const expectedConflictsByKey = new Map(
      fixture.expectedConflicts.map((conflict) => [conflict.key, conflict]),
    );
    const observedConflictsByKey = new Map(
      fixture.observedConflicts.map((conflict) => [conflict.key, conflict]),
    );
    for (const expected of fixture.expected) {
      const observed = observedByKey.get(expected.key);
      let outcome: BenchmarkOutcome;
      if (!observed) outcome = "not_found";
      else if (!fixture.knownDocumentIds.includes(observed.documentId)) outcome = "invented_source";
      else if (
        observed.documentId === expected.documentId &&
        observed.pageNumber === expected.pageNumber &&
        observed.sourceExcerpt !== null &&
        !evidenceExcerptMatches(expected.sourceText, observed.sourceExcerpt)
      )
        outcome = "invented_source";
      else if (observed.value !== expected.value) {
        outcome = observed.reviewStatus === "pending" ? "correctly_pending" : "wrong";
      } else if (
        observed.documentId !== expected.documentId ||
        observed.pageNumber !== expected.pageNumber
      ) {
        outcome = observed.reviewStatus === "pending" ? "correctly_pending" : "wrong";
      } else if (!observed.sourceExcerpt || observed.pageNumber === null) {
        outcome = "correct_incomplete_source";
      } else {
        outcome = evidenceExcerptMatches(expected.sourceText, observed.sourceExcerpt)
          ? "correct_source"
          : "invented_source";
      }
      if (expected.critical && outcome !== "correct_source" && outcome !== "correctly_pending")
        criticalSilentErrors += 1;
      totals[outcome] += 1;
      results.push({
        caseId: fixture.id,
        category: fixture.category,
        key: expected.key,
        outcome,
        critical: expected.critical,
      });
      if (!expected.critical && observed) {
        nonCriticalObserved += 1;
        if (outcome === "correct_source" || outcome === "correct_incomplete_source")
          nonCriticalCorrect += 1;
      }
    }
    for (const observed of fixture.observed) {
      if (expectedByKey.has(observed.key)) continue;
      const outcome = fixture.knownDocumentIds.includes(observed.documentId)
        ? "invented"
        : "invented_source";
      totals[outcome] += 1;
      results.push({
        caseId: fixture.id,
        category: fixture.category,
        key: observed.key,
        outcome,
        critical: false,
      });
      nonCriticalObserved += 1;
    }
    for (const expected of fixture.expectedConflicts) {
      const observed = observedConflictsByKey.get(expected.key);
      const knownSources = observed?.sources.every((source) =>
        fixture.knownDocumentIds.includes(source.documentId),
      );
      const sameSources =
        observed !== undefined && sameConflictSources(expected.sources, observed.sources);
      let outcome: BenchmarkOutcome;
      if (observed && !knownSources) {
        outcome = "invented_source";
        if (expected.critical) criticalSilentErrors += 1;
      } else if (!observed) {
        outcome = "conflict_ignored";
        if (expected.critical) criticalSilentErrors += 1;
      } else if (observed.reviewStatus === "ignored" || observed.reviewStatus === "rejected") {
        outcome = "conflict_ignored";
        if (expected.critical) criticalSilentErrors += 1;
      } else if (!sameSources) {
        outcome = "invented_source";
        if (expected.critical) criticalSilentErrors += 1;
      } else {
        outcome = "conflict_detected";
      }
      totals[outcome] += 1;
      results.push({
        caseId: fixture.id,
        category: fixture.category,
        key: expected.key,
        outcome,
        critical: expected.critical,
      });
    }
    for (const observed of fixture.observedConflicts) {
      if (expectedConflictsByKey.has(observed.key)) continue;
      const outcome = observed.sources.every((source) =>
        fixture.knownDocumentIds.includes(source.documentId),
      )
        ? "invented"
        : "invented_source";
      totals[outcome] += 1;
      results.push({
        caseId: fixture.id,
        category: fixture.category,
        key: observed.key,
        outcome,
        critical: false,
      });
      nonCriticalObserved += 1;
    }
  }

  const nonCriticalPrecision =
    nonCriticalObserved === 0 ? 1 : nonCriticalCorrect / nonCriticalObserved;
  return {
    corpusId: dataset.corpusId,
    corpusHash: dataset.corpusHash,
    totals,
    criticalSilentErrors,
    inventedSources: totals.invented_source,
    nonCriticalPrecision,
    passedSafetyGate:
      criticalSilentErrors === 0 &&
      totals.invented === 0 &&
      totals.invented_source === 0 &&
      nonCriticalPrecision >= 0.98,
    results,
  };
}
