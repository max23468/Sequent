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

const caseSchema = z.object({
  id: z.string().min(1),
  category: z.enum(benchmarkCategories),
  knownDocumentIds: z.array(z.string().min(1)).min(1),
  expected: z.array(expectedFieldSchema),
  observed: z.array(observedFieldSchema),
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
    for (const expected of fixture.expected) {
      const observed = observedByKey.get(expected.key);
      let outcome: BenchmarkOutcome;
      if (!observed) outcome = "not_found";
      else if (!fixture.knownDocumentIds.includes(observed.documentId)) outcome = "invented_source";
      else if (observed.value !== expected.value) {
        outcome = observed.reviewStatus === "pending" ? "correctly_pending" : "wrong";
        if (expected.critical && observed.reviewStatus !== "pending") criticalSilentErrors += 1;
      } else if (!observed.sourceExcerpt || observed.pageNumber === null) {
        outcome = "correct_incomplete_source";
      } else outcome = "correct_source";
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
    passedM3Safety: criticalSilentErrors === 0 && totals.invented_source === 0,
    results,
  };
}
