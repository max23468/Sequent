const CURRENT_DECLARATION_SCHEMA = 7;
const CURRENT_CATALOG_VERSION = "2026.08.27.2";
const CURRENT_RULESET_VERSION = "2026.08.2";
const CURRENT_VALIDATOR_VERSION = "suc13-2.3.1.202603101508";
const OFFICIAL_SOURCE_BUNDLE_ID = "SUC-OFFICIAL-2026-08-27-COMPREHENSIVE";
export const OFFICIAL_SOURCE_LABEL = "Fonti ufficiali acquisite al 27 agosto 2026";

export type FieldState =
  | "missing"
  | "extracted"
  | "automatic"
  | "to_review"
  | "confirmed"
  | "manually_corrected"
  | "calculated"
  | "conflict"
  | "not_applicable"
  | "overridden"
  | "blocked";

export interface CanonicalFieldValue {
  fieldId: string;
  entityId: string | null;
  occurrenceId: string | null;
  value: unknown;
  state: FieldState;
  sourceRefs: string[];
  updatedAt: string;
  confirmedAt?: string;
}

export interface DeclarationSnapshot {
  schemaVersion: number;
  officialSourceBundleId: string;
  catalogVersion: string;
  rulesetVersion: string;
  validatorVersion: string;
  successionOpenedAt: string | null;
  declarationKind: "first" | "substitute-1" | "substitute-2" | "substitute-3";
  fields: Record<string, CanonicalFieldValue>;
  decisions: Array<{
    id: string;
    kind: string;
    summary: string;
    sourceRefs: string[];
    createdAt: string;
  }>;
  officialRuleConfirmations: Record<
    string,
    { ruleIds: string[]; valueJson: string; confirmedAt: string }
  >;
  confirmedDevolutionScenarioId: string | null;
  latestCalculationRunId: string | null;
}

export function createEmptyDeclaration(
  kind: DeclarationSnapshot["declarationKind"] = "first",
): DeclarationSnapshot {
  return {
    schemaVersion: CURRENT_DECLARATION_SCHEMA,
    officialSourceBundleId: OFFICIAL_SOURCE_BUNDLE_ID,
    catalogVersion: CURRENT_CATALOG_VERSION,
    rulesetVersion: CURRENT_RULESET_VERSION,
    validatorVersion: CURRENT_VALIDATOR_VERSION,
    successionOpenedAt: null,
    declarationKind: kind,
    fields: {},
    decisions: [],
    officialRuleConfirmations: {},
    confirmedDevolutionScenarioId: null,
    latestCalculationRunId: null,
  };
}

export function parseDeclaration(value: unknown): DeclarationSnapshot {
  if (!value || typeof value !== "object") return createEmptyDeclaration();
  const candidate = value as Partial<DeclarationSnapshot> & {
    fields?: Record<string, unknown>;
  };
  if (candidate.schemaVersion === CURRENT_DECLARATION_SCHEMA) {
    return {
      ...createEmptyDeclaration(candidate.declarationKind),
      ...candidate,
      fields: (candidate.fields ?? {}) as Record<string, CanonicalFieldValue>,
      decisions: candidate.decisions ?? [],
      officialRuleConfirmations: candidate.officialRuleConfirmations ?? {},
    };
  }

  const migrated = createEmptyDeclaration(candidate.declarationKind);
  migrated.successionOpenedAt = candidate.successionOpenedAt ?? null;
  migrated.decisions = candidate.decisions ?? [];
  migrated.officialRuleConfirmations = candidate.officialRuleConfirmations ?? {};
  migrated.confirmedDevolutionScenarioId = candidate.confirmedDevolutionScenarioId ?? null;
  migrated.latestCalculationRunId = candidate.latestCalculationRunId ?? null;
  for (const [fieldId, fieldValue] of Object.entries(candidate.fields ?? {})) {
    const previous =
      fieldValue && typeof fieldValue === "object"
        ? (fieldValue as Partial<CanonicalFieldValue>)
        : null;
    const canonicalFieldId = previous?.fieldId ?? fieldId;
    const entityId = previous?.entityId ?? null;
    const occurrenceId = previous?.occurrenceId ?? null;
    migrated.fields[canonicalFieldKey(canonicalFieldId, entityId, occurrenceId)] = {
      fieldId: canonicalFieldId,
      entityId,
      occurrenceId,
      value: previous && "value" in previous ? previous.value : fieldValue,
      state: "to_review",
      sourceRefs: previous?.sourceRefs ?? [],
      updatedAt: previous?.updatedAt ?? new Date(0).toISOString(),
    };
  }
  return migrated;
}

export function canonicalFieldKey(
  fieldId: string,
  entityId: string | null = null,
  occurrenceId: string | null = null,
): string {
  if (entityId) return `${fieldId}::${entityId}`;
  if (occurrenceId) return `${fieldId}::occurrence:${occurrenceId}`;
  return fieldId;
}

export function getCanonicalField(
  declaration: DeclarationSnapshot,
  fieldId: string,
  entityId: string | null = null,
  occurrenceId: string | null = null,
): CanonicalFieldValue | undefined {
  return declaration.fields[canonicalFieldKey(fieldId, entityId, occurrenceId)];
}

export function setCanonicalField(
  declaration: DeclarationSnapshot,
  fieldId: string,
  value: unknown,
  state: FieldState,
  sourceRefs: string[] = [],
  entityId: string | null = null,
  occurrenceId: string | null = null,
): DeclarationSnapshot {
  const now = new Date().toISOString();
  const key = canonicalFieldKey(fieldId, entityId, occurrenceId);
  return {
    ...declaration,
    fields: {
      ...declaration.fields,
      [key]: {
        fieldId,
        entityId,
        occurrenceId,
        value,
        state,
        sourceRefs: [...new Set(sourceRefs)],
        updatedAt: now,
        ...(state === "confirmed" || state === "manually_corrected" ? { confirmedAt: now } : {}),
      },
    },
  };
}
