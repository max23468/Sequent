import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { persistUpload, type PersistedUpload } from "./blob-store.ts";
import { enqueueJob, resetExhaustedBlobVerification } from "./jobs.ts";
import { createPractice, getPractice } from "./practices.ts";

export interface IngestedDocument {
  id: string;
  practiceId: string;
  sha256: string;
  byteSize: number;
  blobPath: string;
}

export interface DocumentIngestionFailure {
  status: number;
  message: string;
}

function attachUpload(
  database: Database.Database,
  practiceId: string,
  upload: PersistedUpload,
): { document: IngestedDocument; reused: boolean } {
  const existing = database
    .prepare(
      `SELECT id, sha256, byte_size, blob_path
       FROM documents WHERE practice_id = ? AND sha256 = ?`,
    )
    .get(practiceId, upload.sha256) as
    | { id: string; sha256: string; byte_size: number; blob_path: string }
    | undefined;
  if (existing) {
    return {
      document: {
        id: existing.id,
        practiceId,
        sha256: existing.sha256,
        byteSize: existing.byte_size,
        blobPath: existing.blob_path,
      },
      reused: true,
    };
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO documents(
         id, practice_id, original_name, media_type, byte_size, sha256, blob_path, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      practiceId,
      upload.originalName,
      upload.mediaType,
      upload.byteSize,
      upload.sha256,
      upload.blobPath,
      now,
    );
  database.prepare("UPDATE practices SET updated_at = ? WHERE id = ?").run(now, practiceId);
  return {
    document: {
      id,
      practiceId,
      sha256: upload.sha256,
      byteSize: upload.byteSize,
      blobPath: upload.blobPath,
    },
    reused: false,
  };
}

export function ingestPersistedUpload(
  database: Database.Database,
  upload: PersistedUpload,
  destination: { practiceId: string } | { newPracticeTitle: string },
): IngestedDocument {
  if ("practiceId" in destination && !getPractice(database, destination.practiceId)) {
    throw new Error("PRACTICE_NOT_FOUND");
  }
  const commit = database.transaction(() => {
    const practiceId =
      "practiceId" in destination
        ? destination.practiceId
        : createPractice(database, destination.newPracticeTitle).id;
    const attached = attachUpload(database, practiceId, upload);
    const { document } = attached;
    if (attached.reused) resetExhaustedBlobVerification(database, document.id);
    enqueueJob(
      database,
      "foundation.verify_blob",
      { sha256: document.sha256 },
      { practiceId, documentId: document.id },
    );
    enqueueJob(
      database,
      "document.process",
      { sha256: document.sha256, pipelineVersion: 1 },
      { practiceId, documentId: document.id },
    );
    return document;
  });
  return commit.immediate();
}

export async function ingestDocument(
  database: Database.Database,
  file: File,
  destination: { practiceId: string } | { newPracticeTitle: string },
  dataDirectory?: string,
): Promise<IngestedDocument> {
  if ("practiceId" in destination && !getPractice(database, destination.practiceId)) {
    throw new Error("PRACTICE_NOT_FOUND");
  }
  const upload = await persistUpload(file, dataDirectory);

  return ingestPersistedUpload(database, upload, destination);
}

export function describeDocumentIngestionFailure(error: unknown): DocumentIngestionFailure | null {
  const code = error instanceof Error ? error.message : "";
  if (code === "FILE_TOO_LARGE")
    return { status: 413, message: "Il documento supera il limite consentito." };
  if (code === "EMPTY_FILE") return { status: 400, message: "Il documento selezionato è vuoto." };
  if (code === "PRACTICE_NOT_FOUND") return { status: 404, message: "Pratica non trovata." };
  return null;
}
