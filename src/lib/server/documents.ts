import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export type DocumentStatus =
  | "received"
  | "classifying"
  | "processing"
  | "processed"
  | "to_review"
  | "superseded"
  | "authoritative"
  | "candidate_attachment"
  | "included_attachment"
  | "unsupported"
  | "unreadable"
  | "excluded";

export interface DocumentRecord {
  id: string;
  practiceId: string;
  originalName: string;
  mediaType: string;
  byteSize: number;
  sha256: string;
  blobPath: string;
  status: DocumentStatus;
  detectedFormat: string | null;
  pageCount: number | null;
  language: string | null;
  processingError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExtractedPage {
  pageNumber: number;
  text: string;
  coordinates?: unknown[];
  confidence: number | null;
  language: string | null;
  method: "native" | "ocr" | "structured" | "conversion";
}

export interface ReviewItem {
  id: string;
  practiceId: string;
  documentId: string | null;
  documentName: string | null;
  pageNumber: number | null;
  subjectKey: string;
  label: string;
  proposedValue: unknown;
  alternatives: unknown[];
  method: "structured" | "native_text" | "ocr" | "rule" | "codex" | "calculation" | "manual";
  confidence: number | null;
  sourceExcerpt: string | null;
  sourceRefs: Array<{
    documentId: string;
    pageNumber: number | null;
    excerpt?: string;
    value?: string;
  }>;
  ruleVersion: string | null;
  promptVersion: string | null;
  critical: boolean;
  status: "pending" | "confirmed" | "edited" | "rejected" | "ignored";
  decidedValue: unknown | null;
  updatedAt: string;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function mapDocument(row: Record<string, unknown>): DocumentRecord {
  return {
    id: String(row.id),
    practiceId: String(row.practice_id),
    originalName: String(row.original_name),
    mediaType: String(row.media_type),
    byteSize: Number(row.byte_size),
    sha256: String(row.sha256),
    blobPath: String(row.blob_path),
    status: String(row.status) as DocumentStatus,
    detectedFormat: row.detected_format === null ? null : String(row.detected_format),
    pageCount: row.page_count === null ? null : Number(row.page_count),
    language: row.language === null ? null : String(row.language),
    processingError: row.processing_error === null ? null : String(row.processing_error),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at ?? row.created_at),
  };
}

export function getDocument(
  database: Database.Database,
  documentId: string,
  practiceId?: string,
): DocumentRecord | null {
  const row = database
    .prepare(
      `SELECT * FROM documents
       WHERE id = ? AND (? IS NULL OR practice_id = ?)`,
    )
    .get(documentId, practiceId ?? null, practiceId ?? null) as Record<string, unknown> | undefined;
  return row ? mapDocument(row) : null;
}

export function updateDocumentProcessing(
  database: Database.Database,
  documentId: string,
  update: {
    status: DocumentStatus;
    detectedFormat?: string | null;
    pageCount?: number | null;
    language?: string | null;
    processingError?: string | null;
  },
): void {
  database
    .prepare(
      `UPDATE documents
       SET status = ?,
           detected_format = coalesce(?, detected_format),
           page_count = coalesce(?, page_count),
           language = coalesce(?, language),
           processing_error = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .run(
      update.status,
      update.detectedFormat ?? null,
      update.pageCount ?? null,
      update.language ?? null,
      update.processingError ?? null,
      new Date().toISOString(),
      documentId,
    );
}

export function replaceDocumentPages(
  database: Database.Database,
  documentId: string,
  pages: ExtractedPage[],
): void {
  const now = new Date().toISOString();
  database.transaction(() => {
    database.prepare("DELETE FROM document_pages WHERE document_id = ?").run(documentId);
    const insert = database.prepare(
      `INSERT INTO document_pages(
         id, document_id, page_number, text_content, coordinates_json, confidence,
         language, extraction_method, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const page of pages) {
      insert.run(
        randomUUID(),
        documentId,
        page.pageNumber,
        page.text,
        JSON.stringify(page.coordinates ?? []),
        page.confidence,
        page.language,
        page.method,
        now,
        now,
      );
    }
  })();
}

export function addDocumentArtifact(
  database: Database.Database,
  artifact: {
    documentId: string;
    kind:
      | "searchable_pdf"
      | "page_image"
      | "corrected_image"
      | "office_pdf"
      | "preview"
      | "extracted_text"
      | "ocr_tsv"
      | "signed_content";
    mediaType: string;
    byteSize: number;
    sha256: string;
    blobPath: string;
    pageNumber?: number;
    toolName: string;
    toolVersion: string;
    metadata?: unknown;
  },
): void {
  database
    .prepare(
      `INSERT OR IGNORE INTO document_artifacts(
         id, document_id, kind, media_type, byte_size, sha256, blob_path,
         page_number, tool_name, tool_version, metadata_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      artifact.documentId,
      artifact.kind,
      artifact.mediaType,
      artifact.byteSize,
      artifact.sha256,
      artifact.blobPath,
      artifact.pageNumber ?? null,
      artifact.toolName,
      artifact.toolVersion,
      JSON.stringify(artifact.metadata ?? {}),
      new Date().toISOString(),
    );
}

export function getDocumentText(
  database: Database.Database,
  documentId: string,
): Array<{ pageNumber: number; text: string; confidence: number | null; method: string }> {
  const rows = database
    .prepare(
      `SELECT page_number, text_content, confidence, extraction_method
       FROM document_pages WHERE document_id = ? ORDER BY page_number`,
    )
    .all(documentId) as Array<{
    page_number: number;
    text_content: string;
    confidence: number | null;
    extraction_method: string;
  }>;
  return rows.map((row) => ({
    pageNumber: row.page_number,
    text: row.text_content,
    confidence: row.confidence,
    method: row.extraction_method,
  }));
}

export function createReviewItem(
  database: Database.Database,
  item: {
    practiceId: string;
    documentId?: string;
    pageNumber?: number;
    subjectKey: string;
    label: string;
    proposedValue: unknown;
    alternatives?: unknown[];
    method: ReviewItem["method"];
    confidence?: number | null;
    sourceExcerpt?: string;
    sourceRefs?: Array<{
      documentId: string;
      pageNumber: number | null;
      excerpt?: string;
      value?: string;
    }>;
    ruleVersion?: string;
    promptVersion?: string;
    critical?: boolean;
  },
): string {
  const authoritative = database
    .prepare(
      `SELECT id FROM review_items
       WHERE practice_id = ? AND subject_key = ?
         AND status IN ('confirmed', 'edited')
       ORDER BY updated_at DESC LIMIT 1`,
    )
    .get(item.practiceId, item.subjectKey) as { id: string } | undefined;
  if (authoritative) return authoritative.id;
  const id = randomUUID();
  const now = new Date().toISOString();
  database.transaction(() => {
    database
      .prepare(
        `DELETE FROM review_items
         WHERE practice_id = ? AND subject_key = ? AND status = 'pending'`,
      )
      .run(item.practiceId, item.subjectKey);
    database
      .prepare(
        `INSERT INTO review_items(
           id, practice_id, document_id, page_number, subject_key, label,
           proposed_value_json, alternatives_json, method, confidence, source_excerpt,
           source_refs_json, rule_version, prompt_version, critical, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(
        id,
        item.practiceId,
        item.documentId ?? null,
        item.pageNumber ?? null,
        item.subjectKey,
        item.label,
        JSON.stringify(item.proposedValue),
        JSON.stringify(item.alternatives ?? []),
        item.method,
        item.confidence ?? null,
        item.sourceExcerpt ?? null,
        JSON.stringify(item.sourceRefs ?? []),
        item.ruleVersion ?? null,
        item.promptVersion ?? null,
        item.critical ? 1 : 0,
        now,
        now,
      );
  })();
  return id;
}

function mapReviewItem(row: Record<string, unknown>): ReviewItem {
  return {
    id: String(row.id),
    practiceId: String(row.practice_id),
    documentId: row.document_id === null ? null : String(row.document_id),
    documentName: row.document_name === null ? null : String(row.document_name),
    pageNumber: row.page_number === null ? null : Number(row.page_number),
    subjectKey: String(row.subject_key),
    label: String(row.label),
    proposedValue: parseJson(String(row.proposed_value_json)),
    alternatives: (parseJson(String(row.alternatives_json)) as unknown[]) ?? [],
    method: String(row.method) as ReviewItem["method"],
    confidence: row.confidence === null ? null : Number(row.confidence),
    sourceExcerpt: row.source_excerpt === null ? null : String(row.source_excerpt),
    sourceRefs: (parseJson(String(row.source_refs_json)) as ReviewItem["sourceRefs"]) ?? [],
    ruleVersion: row.rule_version === null ? null : String(row.rule_version),
    promptVersion: row.prompt_version === null ? null : String(row.prompt_version),
    critical: Number(row.critical) === 1,
    status: String(row.status) as ReviewItem["status"],
    decidedValue:
      row.decided_value_json === null ? null : parseJson(String(row.decided_value_json)),
    updatedAt: String(row.updated_at),
  };
}

export function listReviewItems(
  database: Database.Database,
  practiceId: string,
  status: ReviewItem["status"] | "all" = "pending",
): ReviewItem[] {
  const rows = database
    .prepare(
      `SELECT review_items.*, documents.original_name AS document_name
       FROM review_items
       LEFT JOIN documents ON documents.id = review_items.document_id
       WHERE review_items.practice_id = ? AND (? = 'all' OR review_items.status = ?)
       ORDER BY review_items.critical DESC, review_items.created_at, review_items.id`,
    )
    .all(practiceId, status, status) as Array<Record<string, unknown>>;
  return rows.map(mapReviewItem);
}

export function listPendingReviewSummaries(database: Database.Database): Array<{
  id: string;
  practiceId: string;
  practiceTitle: string;
  documentName: string | null;
  label: string;
  method: ReviewItem["method"];
  critical: boolean;
}> {
  const rows = database
    .prepare(
      `SELECT review_items.id, review_items.practice_id, practices.title AS practice_title,
              documents.original_name AS document_name, review_items.label,
              review_items.method, review_items.critical
       FROM review_items
       JOIN practices ON practices.id = review_items.practice_id
       LEFT JOIN documents ON documents.id = review_items.document_id
       WHERE review_items.status = 'pending' AND practices.status = 'active'
       ORDER BY review_items.critical DESC, review_items.created_at
       LIMIT 50`,
    )
    .all() as Array<{
    id: string;
    practice_id: string;
    practice_title: string;
    document_name: string | null;
    label: string;
    method: ReviewItem["method"];
    critical: number;
  }>;
  return rows.map((row) => ({
    id: row.id,
    practiceId: row.practice_id,
    practiceTitle: row.practice_title,
    documentName: row.document_name,
    label: row.label,
    method: row.method,
    critical: row.critical === 1,
  }));
}

export function decideReviewItem(
  database: Database.Database,
  practiceId: string,
  itemId: string,
  decision: {
    status: "confirmed" | "edited" | "rejected" | "ignored";
    value?: unknown;
    note?: string;
  },
): boolean {
  if (decision.status === "confirmed" && decision.value === null) return false;
  const now = new Date().toISOString();
  const result = database.transaction(() => {
    const update = database
      .prepare(
        `UPDATE review_items
         SET status = ?, decided_value_json = ?, decision_note = ?, updated_at = ?
         WHERE id = ? AND practice_id = ? AND status = 'pending'`,
      )
      .run(
        decision.status,
        decision.status === "confirmed" || decision.status === "edited"
          ? JSON.stringify(decision.value)
          : null,
        decision.note ?? null,
        now,
        itemId,
        practiceId,
      );
    if (update.changes === 1) {
      database.prepare("UPDATE practices SET updated_at = ? WHERE id = ?").run(now, practiceId);
    }
    return update.changes === 1;
  })();
  return result;
}
