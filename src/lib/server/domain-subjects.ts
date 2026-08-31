import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  getCanonicalField,
  setCanonicalField,
  type DeclarationSnapshot,
} from "../../domain/declaration.ts";
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

interface CanonicalSubjectIdentity {
  displayName: string | null;
  hasTaxCode: boolean;
  taxCode: string | null;
}

export interface SubjectIdentitySynchronization {
  synchronizedEntries: number;
  synchronizedSubjects: number;
  conflictingSubjects: number;
}

function fieldText(
  declaration: DeclarationSnapshot,
  fieldId: string,
  entityId: string,
): { present: boolean; value: string } {
  const field = getCanonicalField(declaration, fieldId, entityId);
  return {
    present: Boolean(field),
    value: field ? String(field.value ?? "").trim() : "",
  };
}

export function canonicalSubjectIdentity(
  declaration: DeclarationSnapshot,
  entityId: string,
  scope: "subject" | "decedent" = "subject",
): CanonicalSubjectIdentity {
  const prefix = scope === "decedent" ? "frontespizio.defunto" : "quadro-ea.soggetto";
  const surname = fieldText(
    declaration,
    scope === "decedent" ? `${prefix}.cognome` : `${prefix}.dati-anagrafici.cognome`,
    entityId,
  );
  const name = fieldText(declaration, `${prefix}.nome`, entityId);
  const denomination =
    scope === "subject"
      ? fieldText(declaration, `${prefix}.denominazione`, entityId)
      : { present: false, value: "" };
  const taxCode = fieldText(declaration, `${prefix}.codice-fiscale`, entityId);
  return {
    displayName:
      denomination.value || [surname.value, name.value].filter(Boolean).join(" ") || null,
    hasTaxCode: taxCode.present,
    taxCode: taxCode.value || null,
  };
}

export function synchronizeCanonicalSubjectIdentities(
  database: Database.Database,
  practiceId: string,
  declarationId: string,
): SubjectIdentitySynchronization {
  const record = getDeclaration(database, declarationId, practiceId);
  if (!record) throw new Error("DECLARATION_NOT_FOUND");
  const rows = database
    .prepare(
      `SELECT entries.entry_id, entries.subject_id, entries.display_name_snapshot,
              entries.tax_code_snapshot
       FROM declaration_subject_entries AS entries
       JOIN shared_subjects AS subjects ON subjects.id = entries.subject_id
       WHERE entries.declaration_id = ? AND subjects.practice_id = ?
       ORDER BY entries.sequence`,
    )
    .all(declarationId, practiceId) as Array<{
    entry_id: string;
    subject_id: string;
    display_name_snapshot: string | null;
    tax_code_snapshot: string | null;
  }>;
  const candidates = new Map<
    string,
    Array<{ displayName: string | null; hasTaxCode: boolean; taxCode: string | null }>
  >();
  let synchronizedEntries = 0;
  const now = new Date().toISOString();
  for (const row of rows) {
    const identity = canonicalSubjectIdentity(record.declaration, row.entry_id);
    const nextDisplayName = identity.displayName ?? row.display_name_snapshot;
    const nextTaxCode = identity.hasTaxCode ? identity.taxCode : row.tax_code_snapshot;
    if (nextDisplayName !== row.display_name_snapshot || nextTaxCode !== row.tax_code_snapshot) {
      database
        .prepare(
          `UPDATE declaration_subject_entries
           SET display_name_snapshot = ?, tax_code_snapshot = ?
           WHERE declaration_id = ? AND entry_id = ?`,
        )
        .run(nextDisplayName, nextTaxCode, declarationId, row.entry_id);
      synchronizedEntries += 1;
    }
    const subjectCandidates = candidates.get(row.subject_id) ?? [];
    subjectCandidates.push(identity);
    candidates.set(row.subject_id, subjectCandidates);
  }

  const decedent = database
    .prepare(
      `SELECT id FROM shared_subjects
       WHERE practice_id = ? AND role = 'decedent'`,
    )
    .get(practiceId) as { id: string } | undefined;
  if (decedent) {
    candidates.set(decedent.id, [
      canonicalSubjectIdentity(record.declaration, decedent.id, "decedent"),
    ]);
  }

  let synchronizedSubjects = 0;
  let conflictingSubjects = 0;
  for (const [subjectId, identities] of candidates) {
    const displayNames = new Set(
      identities
        .map((identity) => identity.displayName)
        .filter((value): value is string => Boolean(value)),
    );
    const taxCodes = new Set(
      identities
        .filter((identity) => identity.hasTaxCode)
        .map((identity) => identity.taxCode ?? ""),
    );
    if (displayNames.size > 1 || taxCodes.size > 1) {
      conflictingSubjects += 1;
      continue;
    }
    const displayName = displayNames.values().next().value as string | undefined;
    const hasTaxCode = taxCodes.size === 1;
    const taxCodeValue = taxCodes.values().next().value as string | undefined;
    if (!displayName && !hasTaxCode) continue;
    const result = database
      .prepare(
        `UPDATE shared_subjects
         SET display_name = CASE WHEN ? THEN ? ELSE display_name END,
             tax_code = CASE WHEN ? THEN ? ELSE tax_code END,
             revision = revision + 1, updated_at = ?
         WHERE id = ? AND practice_id = ?
           AND ((? AND display_name IS NOT ?) OR (? AND tax_code IS NOT ?))`,
      )
      .run(
        displayName ? 1 : 0,
        displayName ?? null,
        hasTaxCode ? 1 : 0,
        hasTaxCode ? taxCodeValue || null : null,
        now,
        subjectId,
        practiceId,
        displayName ? 1 : 0,
        displayName ?? null,
        hasTaxCode ? 1 : 0,
        hasTaxCode ? taxCodeValue || null : null,
      );
    synchronizedSubjects += result.changes;
  }
  return { synchronizedEntries, synchronizedSubjects, conflictingSubjects };
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
  const record = getDeclaration(database, declarationId, practiceId);
  if (!record) return [];
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
    const identity = canonicalSubjectIdentity(record.declaration, String(row.entry_id));
    const occurrence = (occurrences.get(subjectId) ?? 0) + 1;
    occurrences.set(subjectId, occurrence);
    return {
      id: String(row.entry_id),
      subjectId,
      declarationId: String(row.declaration_id),
      sequence: Number(row.sequence),
      occurrence,
      role: String(row.role) as SubjectRole,
      displayName: identity.displayName ?? String(row.display_name),
      taxCode: identity.hasTaxCode
        ? identity.taxCode
        : row.tax_code === null
          ? null
          : String(row.tax_code),
    };
  });
}

export function listSharedSubjectsForDeclaration(
  database: Database.Database,
  practiceId: string,
  declarationId: string,
): SharedSubject[] {
  const shared = listSharedSubjects(database, practiceId);
  const sharedById = new Map(shared.map((subject) => [subject.id, subject]));
  const record = getDeclaration(database, declarationId, practiceId);
  const entries = listDeclarationSubjectEntries(database, practiceId, declarationId);
  const ordered: SharedSubject[] = [];
  const seen = new Set<string>();
  const decedent = shared.find((subject) => subject.role === "decedent");
  if (decedent) {
    const identity = record
      ? canonicalSubjectIdentity(record.declaration, decedent.id, "decedent")
      : null;
    ordered.push({
      ...decedent,
      displayName: identity?.displayName ?? decedent.displayName,
      taxCode: identity?.hasTaxCode ? identity.taxCode : decedent.taxCode,
    });
    seen.add(decedent.id);
  }
  for (const entry of entries) {
    if (seen.has(entry.subjectId)) continue;
    const subject = sharedById.get(entry.subjectId);
    if (!subject) continue;
    ordered.push({ ...subject, displayName: entry.displayName, taxCode: entry.taxCode });
    seen.add(entry.subjectId);
  }
  ordered.push(...shared.filter((subject) => !seen.has(subject.id)));
  return ordered;
}

export function listDeclarationDossierSubjects(
  database: Database.Database,
  practiceId: string,
  declarationId: string,
): DeclarationDossierSubject[] {
  const decedent = listSharedSubjectsForDeclaration(database, practiceId, declarationId).find(
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
