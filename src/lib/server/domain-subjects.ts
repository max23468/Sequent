import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { setCanonicalField } from "../../domain/declaration.ts";
import { getDeclaration, saveDeclaration } from "./practices.ts";
import type {
  DeclarationDossierSubject,
  DeclarationSubjectEntry,
  SharedSubject,
  SubjectRole,
} from "./domain-model.ts";
import {
  parseRecord,
  recordAuditEvent,
  supersedeDerivedResults,
  invalidateDerivedResultsIfPresent,
} from "./domain-write-support.ts";

export function listSharedSubjects(
  database: Database.Database,
  practiceId: string,
): SharedSubject[] {
  const rows = database
    .prepare(
      `SELECT id, practice_id, role, display_name, tax_code, data_json, revision, updated_at
       FROM shared_subjects WHERE practice_id = ?
       ORDER BY CASE role WHEN 'decedent' THEN 0 WHEN 'beneficiary' THEN 1 ELSE 2 END,
                display_name COLLATE NOCASE`,
    )
    .all(practiceId) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    practiceId: String(row.practice_id),
    role: String(row.role) as SubjectRole,
    displayName: String(row.display_name),
    taxCode: row.tax_code === null ? null : String(row.tax_code),
    data: parseRecord(String(row.data_json)),
    revision: Number(row.revision),
    updatedAt: String(row.updated_at),
  }));
}

export function createSharedSubject(
  database: Database.Database,
  practiceId: string,
  input: {
    role: SubjectRole;
    displayName: string;
    taxCode?: string | null;
    declarationId?: string;
  },
): SharedSubject {
  const id = randomUUID();
  const now = new Date().toISOString();
  database.transaction(() => {
    if (
      input.role === "decedent" &&
      database
        .prepare("SELECT 1 FROM shared_subjects WHERE practice_id = ? AND role = 'decedent'")
        .get(practiceId)
    ) {
      throw new Error("DECEDENT_ALREADY_EXISTS");
    }
    database
      .prepare(
        `INSERT INTO shared_subjects(
           id, practice_id, role, display_name, tax_code, data_json, revision, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, '{}', 1, ?, ?)`,
      )
      .run(id, practiceId, input.role, input.displayName, input.taxCode || null, now, now);
    if (input.role !== "decedent") {
      const declaration = database
        .prepare(
          `SELECT id FROM declarations
           WHERE practice_id = ? AND (? IS NULL OR id = ?)
           ORDER BY sequence DESC LIMIT 1`,
        )
        .get(practiceId, input.declarationId ?? null, input.declarationId ?? null) as
        | { id: string }
        | undefined;
      if (!declaration) throw new Error("DECLARATION_NOT_FOUND");
      const sequence = (
        database
          .prepare(
            `SELECT coalesce(max(sequence), 0) + 1 AS sequence
             FROM declaration_subject_entries WHERE declaration_id = ?`,
          )
          .get(declaration.id) as { sequence: number }
      ).sequence;
      database
        .prepare(
          `INSERT INTO declaration_subject_entries(
             declaration_id, entry_id, subject_id, sequence, created_at,
             role_snapshot, display_name_snapshot, tax_code_snapshot
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          declaration.id,
          id,
          id,
          sequence,
          now,
          input.role,
          input.displayName,
          input.taxCode || null,
        );
    }
    database.prepare("UPDATE practices SET updated_at = ? WHERE id = ?").run(now, practiceId);
    if (input.declarationId)
      invalidateDerivedResultsIfPresent(database, practiceId, input.declarationId);
    recordAuditEvent(
      database,
      practiceId,
      null,
      "subject.created",
      "Aggiunto un soggetto al procedimento.",
      { subjectId: id, role: input.role },
    );
  })();
  const subject = listSharedSubjects(database, practiceId).find((candidate) => candidate.id === id);
  if (!subject) throw new Error("SUBJECT_CREATE_FAILED");
  return subject;
}

export function listDeclarationSubjectEntries(
  database: Database.Database,
  practiceId: string,
  declarationId: string,
): DeclarationSubjectEntry[] {
  const rows = database
    .prepare(
      `SELECT declaration_subject_entries.entry_id,
              declaration_subject_entries.subject_id,
              declaration_subject_entries.declaration_id,
              declaration_subject_entries.sequence,
              coalesce(declaration_subject_entries.role_snapshot, shared_subjects.role) AS role,
              coalesce(
                declaration_subject_entries.display_name_snapshot,
                shared_subjects.display_name
              ) AS display_name,
              declaration_subject_entries.tax_code_snapshot AS tax_code
       FROM declaration_subject_entries
       JOIN declarations ON declarations.id = declaration_subject_entries.declaration_id
       JOIN shared_subjects ON shared_subjects.id = declaration_subject_entries.subject_id
       WHERE declaration_subject_entries.declaration_id = ?
         AND declarations.practice_id = ?
         AND shared_subjects.practice_id = ?
       ORDER BY declaration_subject_entries.sequence`,
    )
    .all(declarationId, practiceId, practiceId) as Array<Record<string, unknown>>;
  const occurrences = new Map<string, number>();
  return rows.map((row) => {
    const subjectId = String(row.subject_id);
    const occurrence = (occurrences.get(subjectId) ?? 0) + 1;
    occurrences.set(subjectId, occurrence);
    return {
      id: String(row.entry_id),
      subjectId,
      declarationId: String(row.declaration_id),
      sequence: Number(row.sequence),
      occurrence,
      role: String(row.role) as SubjectRole,
      displayName: String(row.display_name),
      taxCode: row.tax_code === null ? null : String(row.tax_code),
    };
  });
}

export function listDeclarationDossierSubjects(
  database: Database.Database,
  practiceId: string,
  declarationId: string,
): DeclarationDossierSubject[] {
  const decedent = listSharedSubjects(database, practiceId).find(
    (subject) => subject.role === "decedent",
  );
  const entries = listDeclarationSubjectEntries(database, practiceId, declarationId);
  const seen = new Set<string>();
  const subjects: DeclarationDossierSubject[] = decedent
    ? [
        {
          id: decedent.id,
          role: decedent.role,
          displayName: decedent.displayName,
          taxCode: decedent.taxCode,
        },
      ]
    : [];
  for (const entry of entries) {
    if (seen.has(entry.subjectId)) continue;
    seen.add(entry.subjectId);
    subjects.push({
      id: entry.subjectId,
      role: entry.role,
      displayName: entry.displayName,
      taxCode: entry.taxCode,
    });
  }
  return subjects;
}

export function createDeclarationSubjectEntry(
  database: Database.Database,
  input: {
    practiceId: string;
    declarationId: string;
    sourceEntryId: string;
    expectedRevision: number;
  },
): { entry: DeclarationSubjectEntry; revision: number } {
  const record = getDeclaration(database, input.declarationId, input.practiceId);
  if (!record) throw new Error("DECLARATION_NOT_FOUND");
  const source = listDeclarationSubjectEntries(
    database,
    input.practiceId,
    input.declarationId,
  ).find((entry) => entry.id === input.sourceEntryId);
  if (!source) throw new Error("SUBJECT_ENTRY_NOT_FOUND");
  const id = randomUUID();
  const now = new Date().toISOString();
  const sequence = (
    database
      .prepare(
        `SELECT coalesce(max(sequence), 0) + 1 AS sequence
         FROM declaration_subject_entries WHERE declaration_id = ?`,
      )
      .get(input.declarationId) as { sequence: number }
  ).sequence;
  let declaration = record.declaration;
  for (const field of Object.values(record.declaration.fields)) {
    if (field.entityId !== source.id) continue;
    declaration = setCanonicalField(
      declaration,
      field.fieldId,
      structuredClone(field.value),
      field.state,
      field.sourceRefs,
      id,
    );
  }
  declaration = {
    ...declaration,
    confirmedDevolutionScenarioId: null,
    latestCalculationRunId: null,
  };
  const revision = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO declaration_subject_entries(
           declaration_id, entry_id, subject_id, sequence, created_at,
           role_snapshot, display_name_snapshot, tax_code_snapshot
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.declarationId,
        id,
        source.subjectId,
        sequence,
        now,
        source.role,
        source.displayName,
        source.taxCode,
      );
    supersedeDerivedResults(database, input.practiceId, input.declarationId, now);
    const nextRevision = saveDeclaration(
      database,
      input.declarationId,
      input.expectedRevision,
      declaration,
    );
    recordAuditEvent(
      database,
      input.practiceId,
      input.declarationId,
      "subject.entry_created",
      "Aggiunta un’altra posizione dello stesso soggetto nel Quadro EA.",
      { entryId: id, sourceEntryId: source.id, subjectId: source.subjectId },
    );
    return nextRevision;
  })();
  const entry = listDeclarationSubjectEntries(database, input.practiceId, input.declarationId).find(
    (candidate) => candidate.id === id,
  );
  if (!entry) throw new Error("SUBJECT_ENTRY_CREATE_FAILED");
  return { entry, revision };
}
