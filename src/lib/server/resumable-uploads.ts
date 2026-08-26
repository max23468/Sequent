import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { mkdir, open, rm } from "node:fs/promises";
import { join } from "node:path";
import { persistResumableUpload } from "./blob-store.ts";
import { MAX_UPLOAD_BYTES } from "./config.ts";
import { ingestPersistedUpload, type IngestedDocument } from "./document-ingestion.ts";

const UPLOAD_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_CHUNK_BYTES = 8 * 1024 * 1024;
const locks = new Map<string, Promise<unknown>>();

export interface UploadSession {
  id: string;
  practiceId: string | null;
  newPracticeTitle: string | null;
  originalName: string;
  mediaType: string;
  totalSize: number;
  receivedSize: number;
  tempPath: string;
  status: "uploading" | "completing" | "completed" | "failed";
  resultDocumentId: string | null;
  expiresAt: string;
}

function mapSession(row: Record<string, unknown>): UploadSession {
  return {
    id: String(row.id),
    practiceId: row.practice_id === null ? null : String(row.practice_id),
    newPracticeTitle: row.new_practice_title === null ? null : String(row.new_practice_title),
    originalName: String(row.original_name),
    mediaType: String(row.media_type),
    totalSize: Number(row.total_size),
    receivedSize: Number(row.received_size),
    tempPath: String(row.temp_path),
    status: String(row.status) as UploadSession["status"],
    resultDocumentId: row.result_document_id === null ? null : String(row.result_document_id),
    expiresAt: String(row.expires_at),
  };
}

function getCompletedDocument(
  database: Database.Database,
  session: UploadSession,
): IngestedDocument {
  if (!session.resultDocumentId) throw new Error("UPLOAD_RESULT_MISSING");
  const row = database
    .prepare(
      `SELECT id, practice_id, sha256, byte_size, blob_path
       FROM documents WHERE id = ?`,
    )
    .get(session.resultDocumentId) as
    | {
        id: string;
        practice_id: string;
        sha256: string;
        byte_size: number;
        blob_path: string;
      }
    | undefined;
  if (!row) throw new Error("UPLOAD_RESULT_MISSING");
  return {
    id: row.id,
    practiceId: row.practice_id,
    sha256: row.sha256,
    byteSize: row.byte_size,
    blobPath: row.blob_path,
  };
}

async function withUploadLock<T>(id: string, operation: () => Promise<T>): Promise<T> {
  const previous = locks.get(id) ?? Promise.resolve();
  let release: () => void = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  locks.set(id, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (locks.get(id) === queued) locks.delete(id);
  }
}

export async function createUploadSession(
  database: Database.Database,
  dataDirectory: string,
  input: {
    practiceId?: string;
    newPracticeTitle?: string;
    originalName: string;
    mediaType: string;
    totalSize: number;
  },
): Promise<UploadSession> {
  if (!Number.isSafeInteger(input.totalSize) || input.totalSize <= 0) throw new Error("EMPTY_FILE");
  if (input.totalSize > MAX_UPLOAD_BYTES) throw new Error("FILE_TOO_LARGE");
  if ((input.practiceId ? 1 : 0) + (input.newPracticeTitle ? 1 : 0) !== 1)
    throw new Error("UPLOAD_DESTINATION_INVALID");
  if (input.practiceId) {
    const practice = database
      .prepare("SELECT id FROM practices WHERE id = ? AND status = 'active'")
      .get(input.practiceId);
    if (!practice) throw new Error("PRACTICE_NOT_FOUND");
  }
  const id = randomUUID();
  const directory = join(dataDirectory, "tmp", "resumable");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const tempPath = join(directory, `${id}.part`);
  const handle = await open(tempPath, "wx", 0o600);
  await handle.close();
  const now = new Date();
  database
    .prepare(
      `INSERT INTO upload_sessions(
         id, practice_id, new_practice_title, original_name, media_type, total_size,
         received_size, temp_path, status, created_at, updated_at, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'uploading', ?, ?, ?)`,
    )
    .run(
      id,
      input.practiceId ?? null,
      input.newPracticeTitle ?? null,
      input.originalName,
      input.mediaType || "application/octet-stream",
      input.totalSize,
      tempPath,
      now.toISOString(),
      now.toISOString(),
      new Date(now.getTime() + UPLOAD_TTL_MS).toISOString(),
    );
  return getUploadSession(database, id) as UploadSession;
}

export function getUploadSession(database: Database.Database, id: string): UploadSession | null {
  const row = database.prepare("SELECT * FROM upload_sessions WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapSession(row) : null;
}

export async function appendUploadChunk(
  database: Database.Database,
  id: string,
  expectedOffset: number,
  chunk: Uint8Array,
): Promise<number> {
  if (chunk.byteLength === 0 || chunk.byteLength > MAX_CHUNK_BYTES)
    throw new Error("UPLOAD_CHUNK_INVALID");
  return await withUploadLock(id, async () => {
    const session = getUploadSession(database, id);
    if (!session || session.status !== "uploading") throw new Error("UPLOAD_SESSION_INVALID");
    if (session.receivedSize !== expectedOffset) throw new Error("UPLOAD_OFFSET_MISMATCH");
    if (expectedOffset + chunk.byteLength > session.totalSize)
      throw new Error("UPLOAD_SIZE_MISMATCH");
    const handle = await open(session.tempPath, "r+");
    try {
      let written = 0;
      while (written < chunk.byteLength) {
        const result = await handle.write(
          chunk,
          written,
          chunk.byteLength - written,
          expectedOffset + written,
        );
        if (result.bytesWritten === 0) throw new Error("UPLOAD_WRITE_INCOMPLETE");
        written += result.bytesWritten;
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
    const nextOffset = expectedOffset + chunk.byteLength;
    const result = database
      .prepare(
        `UPDATE upload_sessions SET received_size = ?, updated_at = ?
         WHERE id = ? AND status = 'uploading' AND received_size = ?`,
      )
      .run(nextOffset, new Date().toISOString(), id, expectedOffset);
    if (result.changes !== 1) throw new Error("UPLOAD_OFFSET_MISMATCH");
    return nextOffset;
  });
}

export async function completeUploadSession(
  database: Database.Database,
  dataDirectory: string,
  id: string,
): Promise<IngestedDocument> {
  return await withUploadLock(id, async () => {
    const session = getUploadSession(database, id);
    if (!session) throw new Error("UPLOAD_SESSION_INVALID");
    if (session.status === "completed") {
      const document = getCompletedDocument(database, session);
      await rm(session.tempPath, { force: true });
      return document;
    }
    if (!["uploading", "failed", "completing"].includes(session.status))
      throw new Error("UPLOAD_SESSION_INVALID");
    if (session.receivedSize !== session.totalSize) throw new Error("UPLOAD_INCOMPLETE");
    if (session.status !== "completing") {
      database
        .prepare("UPDATE upload_sessions SET status = 'completing', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), id);
    }
    try {
      const upload = await persistResumableUpload(
        session.tempPath,
        session.originalName,
        session.mediaType,
        session.totalSize,
        dataDirectory,
      );
      const complete = database.transaction(() => {
        const document = ingestPersistedUpload(
          database,
          upload,
          session.practiceId
            ? { practiceId: session.practiceId }
            : { newPracticeTitle: session.newPracticeTitle as string },
        );
        const updated = database
          .prepare(
            `UPDATE upload_sessions
             SET status = 'completed', result_document_id = ?, updated_at = ?
             WHERE id = ? AND status = 'completing'`,
          )
          .run(document.id, new Date().toISOString(), id);
        if (updated.changes !== 1) throw new Error("UPLOAD_SESSION_INVALID");
        return document;
      });
      const document = complete.immediate();
      await rm(session.tempPath, { force: true });
      return document;
    } catch (error) {
      database
        .prepare("UPDATE upload_sessions SET status = 'failed', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), id);
      throw error;
    }
  });
}

export async function cleanupExpiredUploadSessions(
  database: Database.Database,
  now = new Date(),
): Promise<number> {
  const rows = database
    .prepare("SELECT id, temp_path FROM upload_sessions WHERE expires_at < ?")
    .all(now.toISOString()) as Array<{ id: string; temp_path: string }>;
  for (const row of rows) await rm(row.temp_path, { force: true });
  if (rows.length > 0) {
    const ids = rows.map((row) => row.id);
    const placeholders = ids.map(() => "?").join(", ");
    database.prepare(`DELETE FROM upload_sessions WHERE id IN (${placeholders})`).run(...ids);
  }
  return rows.length;
}
