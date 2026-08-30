import type Database from "better-sqlite3";
import {
  canonicalFieldKey,
  getCanonicalField,
  setCanonicalField,
  type DeclarationSnapshot,
} from "../../domain/declaration.ts";
import {
  getCatalogField,
  listOfficialInstructions,
} from "../../domain/official-catalog/catalog.ts";
import { validateFieldValue, type ValidationIssue } from "../../domain/validation.ts";
import { getDeclaration, saveDeclaration } from "./practices.ts";
import { listSharedAssets } from "./domain-assets.ts";
import { synchronizeChecklist } from "./domain-checklist.ts";
import { listDeclarationSubjectEntries, listSharedSubjects } from "./domain-subjects.ts";
import {
  SUCCESSION_OPENING_DATE_FIELD_ID,
  officialAssetValueField,
  wholeEurosToCents,
} from "./domain-model.ts";
import { officialDateToIso } from "./domain-values.ts";
import { recordAuditEvent, supersedeDerivedResults } from "./domain-write-support.ts";

export function saveCanonicalField(
  database: Database.Database,
  input: {
    practiceId: string;
    declarationId: string;
    expectedRevision: number;
    fieldId: string;
    value: string;
    entityId?: string | null;
    occurrenceId?: string | null;
  },
): { revision: number; issues: ValidationIssue[] } {
  return saveCanonicalFields(database, {
    practiceId: input.practiceId,
    declarationId: input.declarationId,
    expectedRevision: input.expectedRevision,
    entityId: input.entityId,
    occurrenceId: input.occurrenceId,
    fields: [{ fieldId: input.fieldId, value: input.value }],
    confirmOfficialRules: true,
  });
}

export function saveCanonicalFields(
  database: Database.Database,
  input: {
    practiceId: string;
    declarationId: string;
    expectedRevision: number;
    fields: Array<{ fieldId: string; value: string }>;
    entityId?: string | null;
    occurrenceId?: string | null;
    confirmOfficialRules?: boolean;
  },
): { revision: number; issues: ValidationIssue[] } {
  const record = getDeclaration(database, input.declarationId, input.practiceId);
  if (!record) throw new Error("DECLARATION_NOT_FOUND");
  const entityId = input.entityId ?? null;
  const occurrenceId = input.occurrenceId ?? null;
  const fields = input.fields.filter(
    (field, index, all) =>
      all.findIndex((candidate) => candidate.fieldId === field.fieldId) === index,
  );
  const technicalField = fields.find(
    (field) => getCatalogField(field.fieldId)?.presentation === "technical-only",
  );
  if (technicalField)
    return {
      revision: record.revision,
      issues: [
        {
          id: "TECHNICAL_FIELD_NOT_EDITABLE",
          level: "blocking",
          fieldId: technicalField.fieldId,
          message:
            "Questo dato tecnico viene preparato automaticamente dal documento allegato e non può essere modificato a mano.",
          sourceId: "SRC-08",
          sourcePointer: "Proprietà tecnica degli allegati",
        },
      ],
    };
  const targetKinds = new Set(
    fields.map((field) => {
      return getCatalogField(field.fieldId)?.entityScope ?? "declaration";
    }),
  );
  if (targetKinds.size > 1) {
    return {
      revision: record.revision,
      issues: [
        {
          id: "FIELD_GROUP_MIXED",
          level: "blocking",
          fieldId: fields[0]?.fieldId ?? null,
          message:
            "Questi dati appartengono a sezioni diverse e devono essere salvati separatamente.",
          sourceId: "SRC-03",
          sourcePointer: "Struttura della dichiarazione",
        },
      ],
    };
  }
  const requiresEaSubject = fields.some(
    (field) => getCatalogField(field.fieldId)?.entityScope === "subject",
  );
  const requiresDecedent = fields.some(
    (field) => getCatalogField(field.fieldId)?.entityScope === "decedent",
  );
  const requiresAsset = fields.some(
    (field) => getCatalogField(field.fieldId)?.entityScope === "asset",
  );
  const requiresOccurrence = fields.some(
    (field) => getCatalogField(field.fieldId)?.entityScope === "occurrence",
  );
  const occurrenceGroups = new Set(
    fields
      .map((field) => getCatalogField(field.fieldId)?.occurrenceGroup)
      .filter((group): group is string => Boolean(group)),
  );
  if (requiresOccurrence && (!occurrenceId || occurrenceGroups.size !== 1)) {
    return {
      revision: record.revision,
      issues: [
        {
          id: "OCCURRENCE_REQUIRED",
          level: "blocking",
          fieldId: fields[0]?.fieldId ?? null,
          occurrenceId,
          message: "Non è stato possibile identificare questa posizione del Quadro.",
          sourceId: "SRC-08",
          sourcePointer: "Struttura ripetibile del Quadro ufficiale",
        },
      ],
    };
  }
  if (requiresEaSubject && !entityId) {
    return {
      revision: record.revision,
      issues: [
        {
          id: "SUBJECT_REQUIRED",
          level: "blocking",
          fieldId: fields.find((field) => field.fieldId.startsWith("quadro-ea."))?.fieldId ?? null,
          message: "Scegli il soggetto al quale appartiene questo dato.",
          sourceId: "SRC-03",
          sourcePointer: "Quadro EA",
        },
      ],
    };
  }
  if (requiresDecedent && !entityId) {
    return {
      revision: record.revision,
      issues: [
        {
          id: "DECEDENT_REQUIRED",
          level: "blocking",
          fieldId:
            fields.find((field) => getCatalogField(field.fieldId)?.entityScope === "decedent")
              ?.fieldId ?? null,
          message: "Aggiungi il defunto alla pratica prima di compilare questo dato.",
          sourceId: "SRC-03",
          sourcePointer: "Frontespizio — Dati del defunto",
        },
      ],
    };
  }
  if (requiresAsset && !entityId) {
    return {
      revision: record.revision,
      issues: [
        {
          id: "ASSET_REQUIRED",
          level: "blocking",
          fieldId:
            fields.find((field) => getCatalogField(field.fieldId)?.entityScope === "asset")
              ?.fieldId ?? null,
          message: "Scegli il bene o la passività a cui appartengono questi dati.",
          sourceId: "SRC-03",
          sourcePointer: "Quadri dei beni e delle passività",
        },
      ],
    };
  }
  const entry = entityId
    ? listDeclarationSubjectEntries(database, input.practiceId, input.declarationId).find(
        (candidate) => candidate.id === entityId,
      )
    : null;
  const decedent =
    entityId && requiresDecedent
      ? listSharedSubjects(database, input.practiceId).find(
          (candidate) => candidate.id === entityId && candidate.role === "decedent",
        )
      : null;
  const asset =
    entityId && requiresAsset
      ? listSharedAssets(database, input.practiceId, input.declarationId).find(
          (candidate) => candidate.id === entityId,
        )
      : null;
  if (
    (requiresEaSubject && !entry) ||
    (requiresDecedent && !decedent) ||
    (requiresAsset && !asset)
  ) {
    return {
      revision: record.revision,
      issues: [
        {
          id: requiresDecedent
            ? "DECEDENT_NOT_FOUND"
            : requiresAsset
              ? "ASSET_NOT_FOUND"
              : "SUBJECT_NOT_FOUND",
          level: "blocking",
          fieldId: fields[0]?.fieldId ?? null,
          message: requiresDecedent
            ? "Il defunto indicato non appartiene più a questa pratica."
            : requiresAsset
              ? "Il bene indicato non appartiene più a questa pratica."
              : "La posizione scelta non appartiene più a questa dichiarazione.",
          sourceId: "SRC-03",
          sourcePointer: requiresDecedent
            ? "Frontespizio — Dati del defunto"
            : requiresAsset
              ? "Quadri dei beni e delle passività"
              : "Quadro EA",
        },
      ],
    };
  }
  const issues = fields.flatMap((field) =>
    field.value === "" ? [] : validateFieldValue(field.fieldId, field.value),
  );
  const fieldsWithInstructions = fields
    .map((field) => ({ ...field, instructions: listOfficialInstructions(field.fieldId) }))
    .filter((field) => field.instructions.length > 0);
  const officialRulesConfirmed = input.confirmOfficialRules !== false;
  if (fieldsWithInstructions.length > 0 && !officialRulesConfirmed)
    issues.push({
      id: "OFFICIAL_INSTRUCTIONS_NOT_CONFIRMED",
      level: "blocking",
      fieldId: fieldsWithInstructions[0]?.fieldId ?? null,
      entityId,
      occurrenceId,
      message:
        "Conferma di aver verificato le indicazioni ministeriali mostrate per questo blocco.",
      sourceId: fieldsWithInstructions[0]?.instructions[0]?.sourceIds[0] ?? "SRC-07",
      sourcePointer:
        fieldsWithInstructions[0]?.instructions[0]?.sourcePointer ?? "Controlli ministeriali",
    });
  const valueField = asset ? officialAssetValueField(asset) : null;
  const officialValue = valueField
    ? fields.find((field) => field.fieldId === valueField.canonicalId)
    : null;
  if (officialValue && wholeEurosToCents(officialValue.value) === null)
    issues.push({
      id: "ASSET_VALUE_FORMAT_INVALID",
      level: "blocking",
      fieldId: officialValue.fieldId,
      entityId: asset?.id ?? null,
      message: "Il valore del bene deve essere indicato in euro interi, usando soltanto cifre.",
      sourceId: valueField?.sourceId ?? "SRC-08",
      sourcePointer: valueField?.sourcePointer ?? "Valore del bene",
    });
  if (issues.some((issue) => issue.level === "blocking"))
    return { revision: record.revision, issues };
  const changedFields = fields.filter(
    (field) =>
      String(
        getCanonicalField(
          record.declaration,
          field.fieldId,
          requiresOccurrence ? null : entityId,
          requiresOccurrence ? occurrenceId : null,
        )?.value ?? "",
      ) !== field.value,
  );
  const confirmations = { ...record.declaration.officialRuleConfirmations };
  const now = new Date().toISOString();
  let confirmationsChanged = false;
  if (officialRulesConfirmed) {
    for (const field of fieldsWithInstructions) {
      const key = canonicalFieldKey(
        field.fieldId,
        requiresOccurrence ? null : entityId,
        requiresOccurrence ? occurrenceId : null,
      );
      const nextConfirmation = {
        ruleIds: field.instructions.map((instruction) => instruction.id).sort(),
        valueJson: JSON.stringify(field.value),
        confirmedAt: now,
      };
      const previous = confirmations[key];
      if (
        previous?.valueJson !== nextConfirmation.valueJson ||
        JSON.stringify([...previous.ruleIds].sort()) !== JSON.stringify(nextConfirmation.ruleIds)
      ) {
        confirmations[key] = nextConfirmation;
        confirmationsChanged = true;
      }
    }
  }
  if (changedFields.length === 0 && !confirmationsChanged)
    return { revision: record.revision, issues: [] };
  let declaration = record.declaration;
  for (const field of changedFields) {
    declaration = setCanonicalField(
      declaration,
      field.fieldId,
      field.value,
      field.value === "" ? "missing" : "manually_corrected",
      ["manual-entry"],
      requiresOccurrence ? null : entityId,
      requiresOccurrence ? occurrenceId : null,
    );
    if (field.fieldId === SUCCESSION_OPENING_DATE_FIELD_ID)
      declaration = {
        ...declaration,
        successionOpenedAt: officialDateToIso(field.value),
      };
    if (field.fieldId === "quadro-ea.soggetto.codice-fiscale" && entry) {
      for (const linkedEntry of listDeclarationSubjectEntries(
        database,
        input.practiceId,
        input.declarationId,
      )) {
        if (linkedEntry.subjectId === entry.subjectId && linkedEntry.id !== entry.id) {
          declaration = setCanonicalField(
            declaration,
            field.fieldId,
            field.value,
            field.value === "" ? "missing" : "manually_corrected",
            ["manual-entry"],
            linkedEntry.id,
          );
        }
      }
    }
  }
  declaration = {
    ...declaration,
    officialRuleConfirmations: confirmations,
    confirmedDevolutionScenarioId: null,
    latestCalculationRunId: null,
  };
  const revision = database.transaction(() => {
    const eaTaxCode = changedFields.find(
      (field) => field.fieldId === "quadro-ea.soggetto.codice-fiscale",
    );
    if (eaTaxCode && entry) {
      database
        .prepare(
          `UPDATE shared_subjects
           SET tax_code = ?, revision = revision + 1, updated_at = ?
           WHERE id = ? AND practice_id = ?`,
        )
        .run(eaTaxCode.value || null, new Date().toISOString(), entry.subjectId, input.practiceId);
      database
        .prepare(
          `UPDATE declaration_subject_entries
           SET tax_code_snapshot = ?
           WHERE declaration_id = ? AND subject_id = ?`,
        )
        .run(eaTaxCode.value || null, input.declarationId, entry.subjectId);
    }
    if (decedent) {
      const data = { ...decedent.data };
      for (const field of changedFields) {
        if (getCatalogField(field.fieldId)?.entityScope === "decedent")
          data[field.fieldId] = field.value;
      }
      const decedentTaxCode = changedFields.find(
        (field) => field.fieldId === "frontespizio.defunto.codice-fiscale",
      );
      database
        .prepare(
          `UPDATE shared_subjects
           SET data_json = ?, tax_code = CASE WHEN ? THEN ? ELSE tax_code END,
               revision = revision + 1, updated_at = ?
           WHERE id = ? AND practice_id = ?`,
        )
        .run(
          JSON.stringify(data),
          decedentTaxCode ? 1 : 0,
          decedentTaxCode?.value || null,
          new Date().toISOString(),
          decedent.id,
          input.practiceId,
        );
    }
    if (asset) {
      const data = { ...asset.data };
      for (const field of changedFields) data[field.fieldId] = field.value;
      const changedOfficialValue = valueField
        ? changedFields.find((field) => field.fieldId === valueField.canonicalId)
        : null;
      if (changedOfficialValue)
        data.valueCents = String(wholeEurosToCents(changedOfficialValue.value) ?? 0n);
      database
        .prepare(
          `UPDATE shared_assets
           SET data_json = ?, revision = revision + 1, updated_at = ?
           WHERE id = ? AND practice_id = ?`,
        )
        .run(JSON.stringify(data), new Date().toISOString(), asset.id, input.practiceId);
    }
    supersedeDerivedResults(
      database,
      input.practiceId,
      input.declarationId,
      new Date().toISOString(),
    );
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
      "fields.updated",
      changedFields.length === 1
        ? "Aggiornato un dato della dichiarazione."
        : "Aggiornato un gruppo di dati della dichiarazione.",
      {
        fieldIds: changedFields.map((field) => field.fieldId),
        entityId,
        occurrenceId,
        revision: nextRevision,
      },
    );
    return nextRevision;
  })();
  synchronizeChecklist(database, input.practiceId, input.declarationId);
  return { revision, issues: [] };
}

function canonicalOccurrenceEntries(
  declaration: DeclarationSnapshot,
  occurrenceGroup: string,
): Array<[string, DeclarationSnapshot["fields"][string]]> {
  return Object.entries(declaration.fields).filter(
    ([, field]) =>
      field.occurrenceId !== null &&
      getCatalogField(field.fieldId)?.occurrenceGroup === occurrenceGroup,
  );
}

export function listCanonicalOccurrenceIds(
  declaration: DeclarationSnapshot,
  occurrenceGroup: string,
): string[] {
  return [
    ...new Set(
      canonicalOccurrenceEntries(declaration, occurrenceGroup).map(
        ([, field]) => field.occurrenceId!,
      ),
    ),
  ];
}

export function reorderCanonicalOccurrences(
  database: Database.Database,
  input: {
    practiceId: string;
    declarationId: string;
    expectedRevision: number;
    occurrenceGroup: string;
    occurrenceIds: string[];
  },
): number {
  const record = getDeclaration(database, input.declarationId, input.practiceId);
  if (!record) throw new Error("DECLARATION_NOT_FOUND");
  if (record.revision !== input.expectedRevision) throw new Error("REVISION_CONFLICT");
  const currentIds = listCanonicalOccurrenceIds(record.declaration, input.occurrenceGroup);
  const requestedIds = [...new Set(input.occurrenceIds)];
  if (
    currentIds.length === 0 ||
    requestedIds.length !== input.occurrenceIds.length ||
    requestedIds.length !== currentIds.length ||
    requestedIds.some((occurrenceId) => !currentIds.includes(occurrenceId))
  )
    throw new Error("OCCURRENCE_ORDER_INVALID");
  if (requestedIds.every((occurrenceId, index) => occurrenceId === currentIds[index]))
    return record.revision;

  const entries = Object.entries(record.declaration.fields);
  const occurrenceEntries = canonicalOccurrenceEntries(record.declaration, input.occurrenceGroup);
  const occurrenceKeys = new Set(occurrenceEntries.map(([key]) => key));
  const entriesByOccurrence = Map.groupBy(occurrenceEntries, ([, field]) => field.occurrenceId!);
  const reorderedEntries = requestedIds.flatMap(
    (occurrenceId) => entriesByOccurrence.get(occurrenceId) ?? [],
  );
  const fields: DeclarationSnapshot["fields"] = {};
  let inserted = false;
  for (const [key, field] of entries) {
    if (occurrenceKeys.has(key)) {
      if (!inserted) {
        for (const [occurrenceKey, occurrenceField] of reorderedEntries)
          fields[occurrenceKey] = occurrenceField;
        inserted = true;
      }
      continue;
    }
    fields[key] = field;
  }
  const nextDeclaration = {
    ...record.declaration,
    fields,
    confirmedDevolutionScenarioId: null,
    latestCalculationRunId: null,
  };
  const revision = database.transaction(() => {
    supersedeDerivedResults(
      database,
      input.practiceId,
      input.declarationId,
      new Date().toISOString(),
    );
    const nextRevision = saveDeclaration(
      database,
      input.declarationId,
      input.expectedRevision,
      nextDeclaration,
    );
    recordAuditEvent(
      database,
      input.practiceId,
      input.declarationId,
      "occurrences.reordered",
      "Riordinate le posizioni ripetibili della dichiarazione.",
      {
        occurrenceGroup: input.occurrenceGroup,
        occurrenceIds: requestedIds,
        revision: nextRevision,
      },
    );
    return nextRevision;
  })();
  synchronizeChecklist(database, input.practiceId, input.declarationId);
  return revision;
}

export function removeCanonicalOccurrence(
  database: Database.Database,
  input: {
    practiceId: string;
    declarationId: string;
    expectedRevision: number;
    occurrenceGroup: string;
    occurrenceId: string;
  },
): number {
  const record = getDeclaration(database, input.declarationId, input.practiceId);
  if (!record) throw new Error("DECLARATION_NOT_FOUND");
  if (record.revision !== input.expectedRevision) throw new Error("REVISION_CONFLICT");
  const occurrenceEntries = canonicalOccurrenceEntries(
    record.declaration,
    input.occurrenceGroup,
  ).filter(([, field]) => field.occurrenceId === input.occurrenceId);
  if (occurrenceEntries.length === 0) throw new Error("OCCURRENCE_NOT_FOUND");
  const removedKeys = new Set(occurrenceEntries.map(([key]) => key));
  const fields = Object.fromEntries(
    Object.entries(record.declaration.fields).filter(([key]) => !removedKeys.has(key)),
  );
  const officialRuleConfirmations = Object.fromEntries(
    Object.entries(record.declaration.officialRuleConfirmations).filter(
      ([key]) => !removedKeys.has(key),
    ),
  );
  const nextDeclaration = {
    ...record.declaration,
    fields,
    officialRuleConfirmations,
    confirmedDevolutionScenarioId: null,
    latestCalculationRunId: null,
  };
  const revision = database.transaction(() => {
    supersedeDerivedResults(
      database,
      input.practiceId,
      input.declarationId,
      new Date().toISOString(),
    );
    const nextRevision = saveDeclaration(
      database,
      input.declarationId,
      input.expectedRevision,
      nextDeclaration,
    );
    recordAuditEvent(
      database,
      input.practiceId,
      input.declarationId,
      "occurrence.removed",
      "Rimossa una posizione ripetibile dalla dichiarazione.",
      {
        occurrenceGroup: input.occurrenceGroup,
        occurrenceId: input.occurrenceId,
        fieldIds: occurrenceEntries.map(([, field]) => field.fieldId),
        revision: nextRevision,
      },
    );
    return nextRevision;
  })();
  synchronizeChecklist(database, input.practiceId, input.declarationId);
  return revision;
}
