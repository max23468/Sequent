import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted";
const MAX_JOB_ATTEMPTS = 3;
const RETRYABLE_JOB_TYPES = new Set(["foundation.verify_blob"]);

export interface JobRecord {
  id: string;
  type: string;
  inputHash: string;
  parameters: unknown;
  status: JobStatus;
  progress: number;
  attempts: number;
  errorCode: string | null;
}

export interface FailedBlobVerification {
  jobId: string;
  practiceId: string;
  practiceTitle: string;
  documentId: string;
  documentName: string;
  attempts: number;
  errorCode: string;
  updatedAt: string;
}

function mapJob(row: Record<string, unknown>): JobRecord {
  return {
    id: String(row.id),
    type: String(row.type),
    inputHash: String(row.input_hash),
    parameters: JSON.parse(String(row.parameters_json)),
    status: String(row.status) as JobStatus,
    progress: Number(row.progress),
    attempts: Number(row.attempts),
    errorCode: row.error_code === null ? null : String(row.error_code),
  };
}

export function enqueueJob(
  database: Database.Database,
  type: string,
  parameters: unknown,
  references: { practiceId?: string; documentId?: string } = {},
): JobRecord {
  const parametersJson = JSON.stringify(parameters);
  const inputHash = createHash("sha256")
    .update(
      `${type}\0${references.practiceId ?? ""}\0${references.documentId ?? ""}\0${parametersJson}`,
    )
    .digest("hex");
  const existing = database
    .prepare("SELECT * FROM jobs WHERE type = ? AND input_hash = ?")
    .get(type, inputHash) as Record<string, unknown> | undefined;
  if (existing) {
    const mapped = mapJob(existing);
    if (
      mapped.status === "failed" &&
      mapped.attempts < MAX_JOB_ATTEMPTS &&
      RETRYABLE_JOB_TYPES.has(mapped.type)
    ) {
      database
        .prepare(
          `UPDATE jobs
           SET status = 'queued', progress = 0, error_code = NULL, updated_at = ?
           WHERE id = ? AND status = 'failed' AND attempts < ?`,
        )
        .run(new Date().toISOString(), mapped.id, MAX_JOB_ATTEMPTS);
      return mapJob(
        database.prepare("SELECT * FROM jobs WHERE id = ?").get(mapped.id) as Record<
          string,
          unknown
        >,
      );
    }
    return mapped;
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO jobs(id, type, practice_id, document_id, input_hash, parameters_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
    )
    .run(
      id,
      type,
      references.practiceId ?? null,
      references.documentId ?? null,
      inputHash,
      parametersJson,
      now,
      now,
    );
  return mapJob(
    database.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Record<string, unknown>,
  );
}

export function recoverInterruptedJobs(database: Database.Database): number {
  const now = new Date().toISOString();
  const transaction = database.transaction(() => {
    const interrupted = database
      .prepare(
        "UPDATE jobs SET status = 'interrupted', error_code = 'PROCESS_RESTART', updated_at = ? WHERE status = 'running'",
      )
      .run(now).changes;
    database
      .prepare(
        "UPDATE jobs SET status = 'queued', updated_at = ? WHERE status = 'interrupted' AND attempts < ?",
      )
      .run(now, MAX_JOB_ATTEMPTS);
    return interrupted;
  });
  return transaction();
}

export function claimNextJob(database: Database.Database): JobRecord | null {
  const transaction = database.transaction(() => {
    const row = database
      .prepare("SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1")
      .get() as Record<string, unknown> | undefined;
    if (!row) return null;
    const now = new Date().toISOString();
    database
      .prepare(
        "UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = 'queued'",
      )
      .run(now, row.id);
    return mapJob(
      database.prepare("SELECT * FROM jobs WHERE id = ?").get(row.id) as Record<string, unknown>,
    );
  });
  return transaction();
}

export function finishJob(database: Database.Database, id: string, errorCode?: string): void {
  database
    .prepare(
      "UPDATE jobs SET status = ?, progress = ?, error_code = ?, updated_at = ? WHERE id = ? AND status = 'running'",
    )
    .run(
      errorCode ? "failed" : "completed",
      errorCode ? 0 : 100,
      errorCode ?? null,
      new Date().toISOString(),
      id,
    );
}

export function listFailedBlobVerifications(
  database: Database.Database,
  practiceId?: string,
): FailedBlobVerification[] {
  const rows = database
    .prepare(
      `SELECT jobs.id AS job_id, jobs.practice_id, practices.title AS practice_title,
              jobs.document_id, documents.original_name AS document_name,
              jobs.attempts, jobs.error_code, jobs.updated_at
       FROM jobs
       JOIN practices ON practices.id = jobs.practice_id
       JOIN documents ON documents.id = jobs.document_id
       WHERE jobs.type = 'foundation.verify_blob'
         AND jobs.status = 'failed'
         AND practices.status = 'active'
         AND (? IS NULL OR jobs.practice_id = ?)
       ORDER BY jobs.updated_at DESC
       LIMIT 20`,
    )
    .all(practiceId ?? null, practiceId ?? null) as Array<{
    job_id: string;
    practice_id: string;
    practice_title: string;
    document_id: string;
    document_name: string;
    attempts: number;
    error_code: string;
    updated_at: string;
  }>;
  return rows.map((row) => ({
    jobId: row.job_id,
    practiceId: row.practice_id,
    practiceTitle: row.practice_title,
    documentId: row.document_id,
    documentName: row.document_name,
    attempts: row.attempts,
    errorCode: row.error_code,
    updatedAt: row.updated_at,
  }));
}
