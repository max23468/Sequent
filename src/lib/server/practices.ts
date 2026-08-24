import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export interface PracticeSummary {
  id: string;
  title: string;
  status: "active" | "archived" | "trashed";
  revision: number;
  documentCount: number;
  updatedAt: string;
}

export interface DocumentSummary {
  id: string;
  practiceId: string;
  originalName: string;
  mediaType: string;
  byteSize: number;
  createdAt: string;
}

export interface DocumentIndexItem extends DocumentSummary {
  practiceTitle: string;
}

export function createPractice(database: Database.Database, title: string): PracticeSummary {
  const id = randomUUID();
  const now = new Date().toISOString();
  const declaration = { schemaVersion: 1, fields: {}, sources: {}, decisions: [] };
  database
    .prepare(
      `INSERT INTO practices(id, title, status, revision, declaration_json, created_at, updated_at)
       VALUES (?, ?, 'active', 1, ?, ?, ?)`,
    )
    .run(id, title, JSON.stringify(declaration), now, now);
  return { id, title, status: "active", revision: 1, documentCount: 0, updatedAt: now };
}

export function listPractices(database: Database.Database): PracticeSummary[] {
  const rows = database
    .prepare(
      `SELECT practices.id, practices.title, practices.status, practices.revision,
              practices.updated_at, count(documents.id) AS document_count
       FROM practices
       LEFT JOIN documents ON documents.practice_id = practices.id
       WHERE practices.status = 'active'
       GROUP BY practices.id
       ORDER BY practices.updated_at DESC`,
    )
    .all() as Array<{
    id: string;
    title: string;
    status: PracticeSummary["status"];
    revision: number;
    document_count: number;
    updated_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    revision: row.revision,
    documentCount: row.document_count,
    updatedAt: row.updated_at,
  }));
}

export function getPractice(
  database: Database.Database,
  practiceId: string,
): PracticeSummary | null {
  const row = database
    .prepare(
      `SELECT practices.id, practices.title, practices.status, practices.revision,
              practices.updated_at, count(documents.id) AS document_count
       FROM practices
       LEFT JOIN documents ON documents.practice_id = practices.id
       WHERE practices.id = ? AND practices.status = 'active'
       GROUP BY practices.id`,
    )
    .get(practiceId) as
    | {
        id: string;
        title: string;
        status: PracticeSummary["status"];
        revision: number;
        document_count: number;
        updated_at: string;
      }
    | undefined;
  return row
    ? {
        id: row.id,
        title: row.title,
        status: row.status,
        revision: row.revision,
        documentCount: row.document_count,
        updatedAt: row.updated_at,
      }
    : null;
}

export function listPracticeDocuments(
  database: Database.Database,
  practiceId: string,
): DocumentSummary[] {
  const rows = database
    .prepare(
      `SELECT id, practice_id, original_name, media_type, byte_size, created_at
       FROM documents WHERE practice_id = ? ORDER BY created_at DESC`,
    )
    .all(practiceId) as Array<{
    id: string;
    practice_id: string;
    original_name: string;
    media_type: string;
    byte_size: number;
    created_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    practiceId: row.practice_id,
    originalName: row.original_name,
    mediaType: row.media_type,
    byteSize: row.byte_size,
    createdAt: row.created_at,
  }));
}

export function listDocuments(database: Database.Database): DocumentIndexItem[] {
  const rows = database
    .prepare(
      `SELECT documents.id, documents.practice_id, documents.original_name, documents.media_type,
              documents.byte_size, documents.created_at, practices.title AS practice_title
       FROM documents
       JOIN practices ON practices.id = documents.practice_id
       WHERE practices.status = 'active'
       ORDER BY documents.created_at DESC`,
    )
    .all() as Array<{
    id: string;
    practice_id: string;
    original_name: string;
    media_type: string;
    byte_size: number;
    created_at: string;
    practice_title: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    practiceId: row.practice_id,
    originalName: row.original_name,
    mediaType: row.media_type,
    byteSize: row.byte_size,
    createdAt: row.created_at,
    practiceTitle: row.practice_title,
  }));
}

export function saveDeclaration(
  database: Database.Database,
  practiceId: string,
  expectedRevision: number,
  declaration: unknown,
): number {
  const now = new Date().toISOString();
  const result = database
    .prepare(
      `UPDATE practices
       SET declaration_json = ?, revision = revision + 1, updated_at = ?
       WHERE id = ? AND revision = ?`,
    )
    .run(JSON.stringify(declaration), now, practiceId, expectedRevision);
  if (result.changes !== 1) throw new Error("REVISION_CONFLICT");
  return expectedRevision + 1;
}
