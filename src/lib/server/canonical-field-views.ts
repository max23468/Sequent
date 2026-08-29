import type Database from "better-sqlite3";
import {
  getCanonicalField,
  type CanonicalFieldValue,
  type DeclarationSnapshot,
} from "../../domain/declaration.ts";
import { listQuadroFields, type QuadroId } from "../../domain/official-catalog/catalog.ts";
import {
  buildOperationalParityMap,
  OPERATIONAL_SECTION_AREAS,
  isOperationalParityAutomatic,
  isOperationalParityEditable,
  listOperationalAreaFields,
  type OperationalSectionId,
} from "../../domain/operational-parity.ts";
import type { ValidationIssue } from "../../domain/validation.ts";
import {
  getAutomaticOfficialFieldValues,
  removeCanonicalOccurrence,
  reorderCanonicalOccurrences,
  saveCanonicalFields,
} from "./domain.ts";
import { getDeclaration } from "./practices.ts";

export type CanonicalFieldView =
  | { kind: "quadri"; quadro: QuadroId }
  | { kind: "operational"; section: OperationalSectionId };

const PARITY_BY_FIELD_ID = new Map(
  buildOperationalParityMap().map((row) => [row.fieldId, row] as const),
);

interface CanonicalFieldIdentity {
  fieldId: string;
  entityId?: string | null;
  occurrenceId?: string | null;
}

interface SaveCanonicalFieldsFromViewInput {
  practiceId: string;
  declarationId: string;
  expectedRevision: number;
  view: CanonicalFieldView;
  fields: Array<{ fieldId: string; value: string }>;
  entityId?: string | null;
  occurrenceId?: string | null;
  confirmOfficialRules?: boolean;
}

function appliesToDeclaration(
  declaration: DeclarationSnapshot,
  field: { appliesToDeclarationKinds: DeclarationSnapshot["declarationKind"][] },
): boolean {
  return (
    field.appliesToDeclarationKinds.length === 0 ||
    field.appliesToDeclarationKinds.includes(declaration.declarationKind)
  );
}

function viewFields(view: CanonicalFieldView) {
  return view.kind === "quadri"
    ? listQuadroFields(view.quadro).filter((field) => field.visibleFieldId !== null)
    : listOperationalAreaFields(OPERATIONAL_SECTION_AREAS[view.section]);
}

function editableViewFieldIds(
  view: CanonicalFieldView,
  declaration: DeclarationSnapshot,
): Set<string> {
  if (view.kind === "quadri")
    return new Set(
      listQuadroFields(view.quadro)
        .filter((field) => field.visibleFieldId !== null)
        .filter((field) => appliesToDeclaration(declaration, field))
        .filter((field) => field.entryMode === "editable")
        .filter((field) => {
          const parity = PARITY_BY_FIELD_ID.get(field.canonicalId);
          return !parity || isOperationalParityEditable(parity, declaration.declarationKind);
        })
        .map((field) => field.canonicalId),
    );
  return new Set(
    listOperationalAreaFields(OPERATIONAL_SECTION_AREAS[view.section])
      .filter((field) => appliesToDeclaration(declaration, field))
      .filter((field) =>
        isOperationalParityEditable(field.operationalParity, declaration.declarationKind),
      )
      .map((field) => field.canonicalId),
  );
}

function visibleViewFieldIds(
  view: CanonicalFieldView,
  declaration: DeclarationSnapshot,
): Set<string> {
  return new Set(
    viewFields(view)
      .filter((field) => appliesToDeclaration(declaration, field))
      .map((field) => field.canonicalId),
  );
}

function visibleOccurrenceGroups(
  view: CanonicalFieldView,
  declaration: DeclarationSnapshot,
): Set<string> {
  return new Set(
    viewFields(view)
      .filter((field) => appliesToDeclaration(declaration, field))
      .map((field) => field.occurrenceGroup)
      .filter((group): group is string => Boolean(group)),
  );
}

function assertOccurrenceGroupVisibleFromView(
  view: CanonicalFieldView,
  declaration: DeclarationSnapshot,
  occurrenceGroup: string,
): void {
  if (!visibleOccurrenceGroups(view, declaration).has(occurrenceGroup))
    throw new Error("OCCURRENCE_GROUP_NOT_VISIBLE_FROM_VIEW");
}

function fieldNotEditableIssue(fieldId: string, view: CanonicalFieldView): ValidationIssue {
  return {
    id: "FIELD_NOT_EDITABLE_FROM_VIEW",
    level: "blocking",
    fieldId,
    message:
      view.kind === "operational"
        ? "Questo dato non è modificabile dalla Vista operativa finché la sua modalità di compilazione non viene qualificata."
        : "Questo dato non è modificabile dal Quadro selezionato o non è applicabile alla dichiarazione corrente.",
    sourceId: "SRC-03/SRC-08",
    sourcePointer: "Vista selezionata, modalità e applicabilità del campo",
  };
}

export function saveCanonicalFieldsFromView(
  database: Database.Database,
  input: SaveCanonicalFieldsFromViewInput,
): { revision: number; issues: ValidationIssue[] } {
  const record = getDeclaration(database, input.declarationId, input.practiceId);
  if (!record) throw new Error("DECLARATION_NOT_FOUND");
  const editableFieldIds = editableViewFieldIds(input.view, record.declaration);
  const unsupportedField = input.fields.find((field) => !editableFieldIds.has(field.fieldId));
  if (unsupportedField)
    return {
      revision: record.revision,
      issues: [fieldNotEditableIssue(unsupportedField.fieldId, input.view)],
    };
  return saveCanonicalFields(database, input);
}

export function readCanonicalFieldsFromView(
  database: Database.Database,
  input: {
    practiceId: string;
    declarationId: string;
    view: CanonicalFieldView;
    fields: CanonicalFieldIdentity[];
  },
): Array<CanonicalFieldValue | undefined> {
  const record = getDeclaration(database, input.declarationId, input.practiceId);
  if (!record) throw new Error("DECLARATION_NOT_FOUND");
  const visibleFieldIds = visibleViewFieldIds(input.view, record.declaration);
  if (input.fields.some((field) => !visibleFieldIds.has(field.fieldId)))
    throw new Error("FIELD_NOT_VISIBLE_FROM_VIEW");
  const automatic = getAutomaticOfficialFieldValues(
    database,
    input.practiceId,
    input.declarationId,
  );
  return input.fields.map((field) => {
    const parity = PARITY_BY_FIELD_ID.get(field.fieldId);
    if (parity && isOperationalParityAutomatic(parity, record.declaration.declarationKind)) {
      const value = automatic?.values[field.fieldId];
      return !automatic || value === undefined
        ? undefined
        : {
            fieldId: field.fieldId,
            entityId: field.entityId ?? null,
            occurrenceId: field.occurrenceId ?? null,
            value,
            state: "calculated",
            sourceRefs: ["SRC-07", "SRC-08", "SRC-10", "SRC-13", "SRC-14"],
            updatedAt: automatic.updatedAt,
          };
    }
    return getCanonicalField(
      record.declaration,
      field.fieldId,
      field.entityId ?? null,
      field.occurrenceId ?? null,
    );
  });
}

export function reorderCanonicalOccurrencesFromView(
  database: Database.Database,
  input: {
    practiceId: string;
    declarationId: string;
    expectedRevision: number;
    view: CanonicalFieldView;
    occurrenceGroup: string;
    occurrenceIds: string[];
  },
): number {
  const record = getDeclaration(database, input.declarationId, input.practiceId);
  if (!record) throw new Error("DECLARATION_NOT_FOUND");
  assertOccurrenceGroupVisibleFromView(input.view, record.declaration, input.occurrenceGroup);
  return reorderCanonicalOccurrences(database, input);
}

export function removeCanonicalOccurrenceFromView(
  database: Database.Database,
  input: {
    practiceId: string;
    declarationId: string;
    expectedRevision: number;
    view: CanonicalFieldView;
    occurrenceGroup: string;
    occurrenceId: string;
  },
): number {
  const record = getDeclaration(database, input.declarationId, input.practiceId);
  if (!record) throw new Error("DECLARATION_NOT_FOUND");
  assertOccurrenceGroupVisibleFromView(input.view, record.declaration, input.occurrenceGroup);
  return removeCanonicalOccurrence(database, input);
}
