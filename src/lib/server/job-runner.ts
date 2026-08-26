import type Database from "better-sqlite3";
import { analyzePracticeWithCodex } from "./codex-analysis.ts";
import { getDataDirectory } from "./config.ts";
import { processDocument } from "./document-processing.ts";
import { verifyBlob } from "./blob-store.ts";
import { claimNextJob, finishJob, updateJobProgress, type JobRecord } from "./jobs.ts";

let running = false;
let timer: NodeJS.Timeout | undefined;

async function execute(database: Database.Database, job: JobRecord): Promise<void> {
  if (job.type === "codex.analyze_practice") {
    const reference = database.prepare("SELECT practice_id FROM jobs WHERE id = ?").get(job.id) as
      | { practice_id: string | null }
      | undefined;
    if (!reference?.practice_id) throw new Error("PRACTICE_NOT_FOUND");
    await analyzePracticeWithCodex(database, reference.practice_id, {
      onProgress: (progress) => updateJobProgress(database, job.id, progress),
    });
    return;
  }
  if (job.type === "document.process") {
    const reference = database.prepare("SELECT document_id FROM jobs WHERE id = ?").get(job.id) as
      | { document_id: string | null }
      | undefined;
    if (!reference?.document_id) throw new Error("DOCUMENT_NOT_FOUND");
    await processDocument(database, reference.document_id);
    return;
  }
  if (job.type !== "foundation.verify_blob") throw new Error("JOB_TYPE_UNSUPPORTED");
  const document = database
    .prepare(
      "SELECT blob_path, sha256 FROM documents WHERE id = (SELECT document_id FROM jobs WHERE id = ?)",
    )
    .get(job.id) as { blob_path: string; sha256: string } | undefined;
  if (!document) throw new Error("DOCUMENT_NOT_FOUND");
  await verifyBlob(getDataDirectory(), document.blob_path, document.sha256);
}

async function tick(database: Database.Database): Promise<void> {
  if (running) return;
  running = true;
  try {
    const job = claimNextJob(database);
    if (!job) return;
    try {
      await execute(database, job);
      finishJob(database, job.id);
    } catch (error) {
      const code = error instanceof Error ? error.message.slice(0, 80) : "JOB_FAILED";
      finishJob(database, job.id, code);
    }
  } finally {
    running = false;
  }
}

export function startJobRunner(database: Database.Database): void {
  if (timer) return;
  timer = setInterval(() => void tick(database), 500);
  timer.unref();
  void tick(database);
}
