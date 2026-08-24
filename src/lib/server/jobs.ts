import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted";

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
  if (existing) return mapJob(existing);

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
        "UPDATE jobs SET status = 'queued', updated_at = ? WHERE status = 'interrupted' AND attempts < 3",
      )
      .run(now);
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

export function countActiveJobs(database: Database.Database): number {
  const row = database
    .prepare("SELECT count(*) AS count FROM jobs WHERE status IN ('queued', 'running')")
    .get() as {
    count: number;
  };
  return row.count;
}
