import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  createEmptyDeclaration,
  parseDeclaration,
  type DeclarationSnapshot,
} from "../../domain/declaration.ts";

export interface PracticeSummary {
  id: string;
  title: string;
  status: "active" | "archived" | "trashed";
  declarationId: string;
  revision: number;
  documentCount: number;
  updatedAt: string;
}

export interface DeclarationRecord {
  id: string;
  practiceId: string;
  sequence: number;
  revision: number;
  declaration: DeclarationSnapshot;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentSummary {
  id: string;
  practiceId: string;
  originalName: string;
  mediaType: string;
  byteSize: number;
  status: string;
  detectedFormat: string | null;
  pageCount: number | null;
  language: string | null;
  processingError: string | null;
  createdAt: string;
}

export interface DocumentIndexItem extends DocumentSummary {
  practiceTitle: string;
}

export function createPractice(database: Database.Database, title: string): PracticeSummary {
  const id = randomUUID();
  const declarationId = randomUUID();
  const now = new Date().toISOString();
  const declaration = createEmptyDeclaration();
  database.transaction(() => {
    database
      .prepare(
        `INSERT INTO practices(id, title, status, created_at, updated_at)
         VALUES (?, ?, 'active', ?, ?)`,
      )
      .run(id, title, now, now);
    database
      .prepare(
        `INSERT INTO declarations(id, practice_id, sequence, revision, declaration_json, created_at, updated_at)
         VALUES (?, ?, 1, 1, ?, ?, ?)`,
      )
      .run(declarationId, id, JSON.stringify(declaration), now, now);
  })();
  return {
    id,
    title,
    status: "active",
    declarationId,
    revision: 1,
    documentCount: 0,
    updatedAt: now,
  };
}

export function getDeclaration(
  database: Database.Database,
  declarationId: string,
  practiceId?: string,
): DeclarationRecord | null {
  const row = database
    .prepare(
      `SELECT id, practice_id, sequence, revision, declaration_json, created_at, updated_at
       FROM declarations
       WHERE id = ? AND (? IS NULL OR practice_id = ?)`,
    )
    .get(declarationId, practiceId ?? null, practiceId ?? null) as
    | {
        id: string;
        practice_id: string;
        sequence: number;
        revision: number;
        declaration_json: string;
        created_at: string;
        updated_at: string;
      }
    | undefined;
  if (!row) return null;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(row.declaration_json);
  } catch {
    parsed = null;
  }
  return {
    id: row.id,
    practiceId: row.practice_id,
    sequence: row.sequence,
    revision: row.revision,
    declaration: parseDeclaration(parsed),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listDeclarations(
  database: Database.Database,
  practiceId: string,
): DeclarationRecord[] {
  const rows = database
    .prepare(`SELECT id FROM declarations WHERE practice_id = ? ORDER BY sequence ASC`)
    .all(practiceId) as Array<{ id: string }>;
  return rows.flatMap(({ id }) => {
    const declaration = getDeclaration(database, id, practiceId);
    return declaration ? [declaration] : [];
  });
}

export function createSuccessiveDeclaration(
  database: Database.Database,
  practiceId: string,
  sourceDeclarationId: string,
  kind: "substitute-1" | "substitute-2" | "substitute-3",
): DeclarationRecord {
  const source = getDeclaration(database, sourceDeclarationId, practiceId);
  if (!source) throw new Error("DECLARATION_NOT_FOUND");
  const id = randomUUID();
  const now = new Date().toISOString();
  const copiedFields = Object.fromEntries(
    Object.entries(structuredClone(source.declaration.fields)).filter(
      ([, field]) =>
        field.fieldId !==
        "xsd:/Fornitura/Dichiarazione/Frontespizio/Presentatore/DecorrenzaTerminePresentazione",
    ),
  );
  const snapshot: DeclarationSnapshot = {
    ...structuredClone(source.declaration),
    fields: copiedFields,
    declarationKind: kind,
    confirmedDevolutionScenarioId: null,
    latestCalculationRunId: null,
    decisions: [],
  };
  const sequence = (
    database
      .prepare(
        "SELECT coalesce(max(sequence), 0) + 1 AS sequence FROM declarations WHERE practice_id = ?",
      )
      .get(practiceId) as { sequence: number }
  ).sequence;
  database.transaction(() => {
    database
      .prepare(
        `INSERT INTO declarations(id, practice_id, sequence, revision, declaration_json, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?, ?)`,
      )
      .run(id, practiceId, sequence, JSON.stringify(snapshot), now, now);
    database
      .prepare(
        `INSERT INTO declaration_subject_entries(
           declaration_id, entry_id, subject_id, sequence, created_at,
           role_snapshot, display_name_snapshot, tax_code_snapshot
         )
         SELECT ?, entry_id, subject_id, sequence, ?,
                role_snapshot, display_name_snapshot, tax_code_snapshot
         FROM declaration_subject_entries
         WHERE declaration_id = ?
         ORDER BY sequence`,
      )
      .run(id, now, sourceDeclarationId);
    database
      .prepare(
        `INSERT INTO declaration_asset_entries(declaration_id, asset_id, created_at)
         SELECT ?, asset_id, ?
         FROM declaration_asset_entries
         WHERE declaration_id = ?`,
      )
      .run(id, now, sourceDeclarationId);
    database
      .prepare(
        `INSERT INTO domain_audit_events(id, practice_id, declaration_id, event_type, summary, payload_json, created_at)
         VALUES (?, ?, ?, 'declaration.snapshot_created', ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        practiceId,
        id,
        "Creata dichiarazione successiva da snapshot esplicito.",
        JSON.stringify({ sourceDeclarationId, kind }),
        now,
      );
    database.prepare("UPDATE practices SET updated_at = ? WHERE id = ?").run(now, practiceId);
  })();
  const created = getDeclaration(database, id, practiceId);
  if (!created) throw new Error("DECLARATION_CREATE_FAILED");
  return created;
}

export function listPractices(database: Database.Database): PracticeSummary[] {
  const rows = database
    .prepare(
      `SELECT practices.id, practices.title, practices.status,
              declarations.id AS declaration_id, declarations.revision,
              practices.updated_at, count(documents.id) AS document_count
       FROM practices
       JOIN declarations ON declarations.practice_id = practices.id
         AND declarations.sequence = (
           SELECT max(latest.sequence) FROM declarations AS latest
           WHERE latest.practice_id = practices.id
         )
       LEFT JOIN documents ON documents.practice_id = practices.id
       WHERE practices.status = 'active'
       GROUP BY practices.id
       ORDER BY practices.updated_at DESC`,
    )
    .all() as Array<{
    id: string;
    title: string;
    status: PracticeSummary["status"];
    declaration_id: string;
    revision: number;
    document_count: number;
    updated_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    declarationId: row.declaration_id,
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
      `SELECT practices.id, practices.title, practices.status,
              declarations.id AS declaration_id, declarations.revision,
              practices.updated_at, count(documents.id) AS document_count
       FROM practices
       JOIN declarations ON declarations.practice_id = practices.id
         AND declarations.sequence = (
           SELECT max(latest.sequence) FROM declarations AS latest
           WHERE latest.practice_id = practices.id
         )
       LEFT JOIN documents ON documents.practice_id = practices.id
       WHERE practices.id = ? AND practices.status = 'active'
       GROUP BY practices.id`,
    )
    .get(practiceId) as
    | {
        id: string;
        title: string;
        status: PracticeSummary["status"];
        declaration_id: string;
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
        declarationId: row.declaration_id,
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
      `SELECT id, practice_id, original_name, media_type, byte_size, status,
              detected_format, page_count, language, processing_error, created_at
       FROM documents WHERE practice_id = ? ORDER BY created_at DESC`,
    )
    .all(practiceId) as Array<{
    id: string;
    practice_id: string;
    original_name: string;
    media_type: string;
    byte_size: number;
    status: string;
    detected_format: string | null;
    page_count: number | null;
    language: string | null;
    processing_error: string | null;
    created_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    practiceId: row.practice_id,
    originalName: row.original_name,
    mediaType: row.media_type,
    byteSize: row.byte_size,
    status: row.status,
    detectedFormat: row.detected_format,
    pageCount: row.page_count,
    language: row.language,
    processingError: row.processing_error,
    createdAt: row.created_at,
  }));
}

export function listDocuments(database: Database.Database): DocumentIndexItem[] {
  const rows = database
    .prepare(
      `SELECT documents.id, documents.practice_id, documents.original_name, documents.media_type,
              documents.byte_size, documents.status, documents.detected_format,
              documents.page_count, documents.language, documents.processing_error,
              documents.created_at, practices.title AS practice_title
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
    status: string;
    detected_format: string | null;
    page_count: number | null;
    language: string | null;
    processing_error: string | null;
    created_at: string;
    practice_title: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    practiceId: row.practice_id,
    originalName: row.original_name,
    mediaType: row.media_type,
    byteSize: row.byte_size,
    status: row.status,
    detectedFormat: row.detected_format,
    pageCount: row.page_count,
    language: row.language,
    processingError: row.processing_error,
    createdAt: row.created_at,
    practiceTitle: row.practice_title,
  }));
}

export function saveDeclaration(
  database: Database.Database,
  declarationId: string,
  expectedRevision: number,
  declaration: unknown,
): number {
  const now = new Date().toISOString();
  const result = database.transaction(() => {
    const update = database
      .prepare(
        `UPDATE declarations
         SET declaration_json = ?, revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ?`,
      )
      .run(JSON.stringify(declaration), now, declarationId, expectedRevision);
    if (update.changes !== 1) throw new Error("REVISION_CONFLICT");
    database
      .prepare(
        `UPDATE practices SET updated_at = ?
         WHERE id = (SELECT practice_id FROM declarations WHERE id = ?)`,
      )
      .run(now, declarationId);
    return update;
  })();
  if (result.changes !== 1) throw new Error("REVISION_CONFLICT");
  return expectedRevision + 1;
}
