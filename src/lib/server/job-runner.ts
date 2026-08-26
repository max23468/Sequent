import type Database from "better-sqlite3";
import { analyzePracticeWithCodex } from "./codex-analysis.ts";
import { getDataDirectory } from "./config.ts";
import { processDocument } from "./document-processing.ts";
import { verifyBlob } from "./blob-store.ts";
import {
  cancelQueuedJob,
  claimNextJob,
  finishJob,
  updateJobProgress,
  type JobRecord,
} from "./jobs.ts";

let running = false;
let timer: NodeJS.Timeout | undefined;
const activeControllers = new Map<string, AbortController>();

async function execute(
  database: Database.Database,
  job: JobRecord,
  signal: AbortSignal,
): Promise<void> {
  if (job.type === "codex.analyze_practice") {
    const reference = database.prepare("SELECT practice_id FROM jobs WHERE id = ?").get(job.id) as
      | { practice_id: string | null }
      | undefined;
    if (!reference?.practice_id) throw new Error("PRACTICE_NOT_FOUND");
    await analyzePracticeWithCodex(database, reference.practice_id, {
      signal,
      onProgress: (progress) => updateJobProgress(database, job.id, progress),
    });
    return;
  }
  if (job.type === "document.process") {
    const reference = database.prepare("SELECT document_id FROM jobs WHERE id = ?").get(job.id) as
      | { document_id: string | null }
      | undefined;
    if (!reference?.document_id) throw new Error("DOCUMENT_NOT_FOUND");
    await processDocument(database, reference.document_id, {
      signal,
      onProgress: (progress) => updateJobProgress(database, job.id, progress),
    });
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
    const controller = new AbortController();
    activeControllers.set(job.id, controller);
    try {
      await execute(database, job, controller.signal);
      finishJob(database, job.id);
    } catch (error) {
      const code = error instanceof Error ? error.message.slice(0, 80) : "JOB_FAILED";
      if (code !== "TOOL_CANCELLED") finishJob(database, job.id, code);
    } finally {
      activeControllers.delete(job.id);
    }
  } finally {
    running = false;
  }
}

export function cancelPracticeJob(
  database: Database.Database,
  jobId: string,
  practiceId: string,
): boolean {
  if (cancelQueuedJob(database, jobId, practiceId)) return true;
  const row = database
    .prepare("SELECT status, type FROM jobs WHERE id = ? AND practice_id = ?")
    .get(jobId, practiceId) as { status: string; type: string } | undefined;
  const controller =
    row?.status === "running" &&
    (row.type === "document.process" || row.type === "codex.analyze_practice")
      ? activeControllers.get(jobId)
      : undefined;
  if (!controller) return false;
  const changed = database
    .prepare(
      `UPDATE jobs
       SET status = 'cancelled', error_code = 'USER_CANCELLED', updated_at = ?
       WHERE id = ? AND practice_id = ? AND status = 'running'`,
    )
    .run(new Date().toISOString(), jobId, practiceId).changes;
  if (changed !== 1) return false;
  controller.abort();
  return true;
}

export function startJobRunner(database: Database.Database): void {
  if (timer) return;
  timer = setInterval(() => void tick(database), 500);
  timer.unref();
  void tick(database);
}
