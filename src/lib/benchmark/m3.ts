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
  documentIds: z.array(z.string().min(1)).min(2),
  critical: z.boolean(),
});

const observedConflictSchema = z.object({
  key: z.string().min(1),
  documentIds: z.array(z.string().min(1)).min(2),
  reviewStatus: z.enum(["pending", "confirmed", "edited", "rejected", "ignored"]),
});

const caseSchema = z.object({
  id: z.string().min(1),
  category: z.enum(benchmarkCategories),
  knownDocumentIds: z.array(z.string().min(1)).min(1),
  expected: z.array(expectedFieldSchema),
  observed: z.array(observedFieldSchema),
  expectedConflicts: z.array(expectedConflictSchema).default([]),
  observedConflicts: z.array(observedConflictSchema).default([]),
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
  passedM3Safety: boolean;
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

export function evaluateM3Benchmark(input: unknown): BenchmarkReport {
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
      else if (observed.value !== expected.value) {
        outcome = observed.reviewStatus === "pending" ? "correctly_pending" : "wrong";
      } else if (
        observed.documentId !== expected.documentId ||
        observed.pageNumber !== expected.pageNumber
      ) {
        outcome = observed.reviewStatus === "pending" ? "correctly_pending" : "wrong";
      } else if (!observed.sourceExcerpt || observed.pageNumber === null) {
        outcome = "correct_incomplete_source";
      } else outcome = "correct_source";
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
      const knownSources = observed?.documentIds.every((id) =>
        fixture.knownDocumentIds.includes(id),
      );
      const observedSources = new Set(observed?.documentIds ?? []);
      const expectedSources = new Set(expected.documentIds);
      const sameSources =
        observed !== undefined &&
        observed.documentIds.length === expected.documentIds.length &&
        observedSources.size === observed.documentIds.length &&
        expectedSources.size === expected.documentIds.length &&
        expected.documentIds.every((id) => observedSources.has(id));
      let outcome: BenchmarkOutcome;
      if (observed && !knownSources) {
        outcome = "invented_source";
        if (expected.critical) criticalSilentErrors += 1;
      } else if (!observed || !sameSources) {
        outcome = "conflict_ignored";
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
      const outcome = observed.documentIds.every((id) => fixture.knownDocumentIds.includes(id))
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
    passedM3Safety:
      criticalSilentErrors === 0 &&
      totals.invented === 0 &&
      totals.invented_source === 0 &&
      nonCriticalPrecision >= 0.98,
    results,
  };
}
