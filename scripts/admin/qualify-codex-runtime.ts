import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { evaluateExtractionSafetyBenchmark } from "../../src/lib/benchmark/extraction-safety.ts";
import { analyzePracticeWithCodex } from "../../src/lib/server/codex-analysis.ts";
import { getCodexCapability } from "../../src/lib/server/codex-capability.ts";
import { closeDatabase, openDatabase } from "../../src/lib/server/database.ts";
import { ingestDocument } from "../../src/lib/server/document-ingestion.ts";
import { processDocument } from "../../src/lib/server/document-processing.ts";
import { listReviewItems } from "../../src/lib/server/documents.ts";
import { createPractice } from "../../src/lib/server/practices.ts";
import { runCommand } from "../../src/lib/server/process-tools.ts";

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

const outputPath = argument("--output");
if (process.env.OPENAI_API_KEY) throw new Error("CODEX_QUALIFICATION_API_KEY_DISALLOWED");
if (process.env.SEQUENT_CODEX_ENABLED !== "true")
  throw new Error("CODEX_QUALIFICATION_NOT_ENABLED");

const capability = await getCodexCapability();
if (capability.state !== "authenticated") {
  throw new Error(`CODEX_QUALIFICATION_AUTH_REQUIRED:${capability.state}`);
}

const directory = await mkdtemp(`${tmpdir()}/sequent-codex-qualification-`);
const database = openDatabase(directory);
const sourceText = [
  "Scheda sintetica controllata per la qualificazione Codex.",
  "Beneficiario: ADA VERDI.",
  "Data di apertura della successione: 12/08/2026.",
  "Codice di controllo: QUAL-CODEX-2026.",
].join("\n");

try {
  const practice = createPractice(database, "Qualificazione Codex sintetica");
  const document = await ingestDocument(
    database,
    new File([sourceText], "qualificazione-codex.txt", { type: "text/plain" }),
    { practiceId: practice.id },
    directory,
  );
  await processDocument(database, document.id, { dataDirectory: directory });
  const imagePath = resolve(directory, "qualificazione-codex.png");
  await runCommand("magick", ["-size", "256x256", "xc:white", imagePath], {
    timeoutMs: 30_000,
    maxOutputBytes: 32_768,
  });
  const imageBytes = await readFile(imagePath);
  const imageDocument = await ingestDocument(
    database,
    new File([imageBytes], "qualificazione-codex.png", { type: "image/png" }),
    { practiceId: practice.id },
    directory,
  );
  await processDocument(database, imageDocument.id, { dataDirectory: directory });
  const run = await analyzePracticeWithCodex(database, practice.id, { dataDirectory: directory });
  const reviews = listReviewItems(database, practice.id).filter((item) => item.method === "codex");
  const proposals = reviews.filter((item) => typeof item.proposedValue === "string");
  const conflicts = reviews.filter(
    (item) => item.proposedValue === null && item.alternatives.length >= 2,
  );
  const expectedValues = [
    { value: "ADA VERDI", critical: false },
    { value: "12/08/2026", critical: true },
    { value: "QUAL-CODEX-2026", critical: false },
  ];
  const expected = expectedValues.map(({ value, critical }) => {
    const observed = proposals.find((item) => item.proposedValue === value);
    return {
      key: observed?.subjectKey ?? `atteso:${createHash("sha256").update(value).digest("hex")}`,
      value,
      documentId: document.id,
      pageNumber: 1,
      sourceText,
      critical,
    };
  });
  const report = evaluateExtractionSafetyBenchmark({
    corpusId: "codex-private-controlled-v1",
    corpusHash: createHash("sha256").update(sourceText).update(imageBytes).digest("hex"),
    cases: [
      {
        id: "codex-synthetic-control",
        category: "identity_document",
        knownDocumentIds: [document.id, imageDocument.id],
        expected,
        observed: proposals.map((item) => ({
          key: item.subjectKey,
          value: typeof item.proposedValue === "string" ? item.proposedValue : null,
          documentId: item.documentId ?? "documento-assente",
          pageNumber: item.pageNumber,
          sourceExcerpt: item.sourceExcerpt,
          reviewStatus: item.status,
        })),
        expectedConflicts: [],
        observedConflicts: conflicts.map((item) => ({
          key: item.subjectKey,
          sources: item.sourceRefs.map((source) => ({
            documentId: source.documentId,
            pageNumber: source.pageNumber ?? 0,
            value: source.value ?? "",
            sourceExcerpt: source.excerpt ?? "",
          })),
          reviewStatus: item.status,
        })),
      },
    ],
  });
  const persisted = database
    .prepare(
      `SELECT runs.status, runs.thread_id, threads.thread_id AS persisted_thread_id
       FROM codex_runs AS runs
       JOIN codex_threads AS threads ON threads.practice_id = runs.practice_id
       WHERE runs.id = ?`,
    )
    .get(run.runId) as
    | { status: string; thread_id: string | null; persisted_thread_id: string }
    | undefined;
  if (
    persisted?.status !== "completed" ||
    !persisted.thread_id ||
    persisted.thread_id !== persisted.persisted_thread_id
  ) {
    throw new Error("CODEX_QUALIFICATION_THREAD_NOT_PERSISTED");
  }

  const sanitizedReport = {
    format: "sequent-codex-runtime-qualification",
    version: 1,
    generatedAt: new Date().toISOString(),
    commit: process.env.SEQUENT_COMMIT_SHA ?? "working-tree",
    capability: capability.state,
    run: {
      completed: true,
      threadPersisted: true,
      imageInput: true,
      proposals: run.proposals,
      conflicts: run.conflicts,
    },
    benchmark: {
      passedSafetyGate: report.passedSafetyGate,
      criticalSilentErrors: report.criticalSilentErrors,
      inventedSources: report.inventedSources,
      nonCriticalPrecision: report.nonCriticalPrecision,
      totals: report.totals,
    },
  };
  if (outputPath) {
    await writeFile(resolve(outputPath), `${JSON.stringify(sanitizedReport, null, 2)}\n`, {
      mode: 0o600,
    });
  }
  process.stdout.write(`${JSON.stringify(sanitizedReport)}\n`);
  if (!report.passedSafetyGate) process.exitCode = 1;
} finally {
  closeDatabase(directory);
  await rm(directory, { recursive: true, force: true });
}
