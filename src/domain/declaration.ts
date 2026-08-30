import { z } from "zod";

const CURRENT_DECLARATION_SCHEMA = 7;
export const CURRENT_CATALOG_VERSION = "2026.08.27.2";
export const CURRENT_RULESET_VERSION = "2026.08.12";
const CURRENT_VALIDATOR_VERSION = "suc13-2.3.1.202603101508";
export const OFFICIAL_SOURCE_BUNDLE_ID = "SUC-OFFICIAL-2026-08-27-COMPREHENSIVE";
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

const fieldStateSchema = z.enum([
  "missing",
  "extracted",
  "automatic",
  "to_review",
  "confirmed",
  "manually_corrected",
  "calculated",
  "conflict",
  "not_applicable",
  "overridden",
  "blocked",
]);

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year!, month! - 1, day!));
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month! - 1 &&
      parsed.getUTCDate() === day
    );
  });

const canonicalFieldValueSchema = z
  .object({
    fieldId: z.string().min(1),
    entityId: z.string().nullable(),
    occurrenceId: z.string().nullable(),
    value: z.unknown(),
    state: fieldStateSchema,
    sourceRefs: z.array(z.string()),
    updatedAt: z.string().datetime(),
    confirmedAt: z.string().datetime().optional(),
  })
  .strict();

const declarationSnapshotSchema = z
  .object({
    schemaVersion: z.literal(CURRENT_DECLARATION_SCHEMA),
    officialSourceBundleId: z.string().min(1),
    catalogVersion: z.string().min(1),
    rulesetVersion: z.string().min(1),
    validatorVersion: z.string().min(1),
    successionOpenedAt: isoDateSchema.nullable(),
    declarationKind: z.enum(["first", "substitute-1", "substitute-2", "substitute-3"]),
    fields: z.record(z.string(), canonicalFieldValueSchema),
    decisions: z.array(
      z
        .object({
          id: z.string().min(1),
          kind: z.string().min(1),
          summary: z.string(),
          sourceRefs: z.array(z.string()),
          createdAt: z.string().datetime(),
        })
        .strict(),
    ),
    officialRuleConfirmations: z.record(
      z.string(),
      z
        .object({
          ruleIds: z.array(z.string()),
          valueJson: z.string(),
          confirmedAt: z.string().datetime(),
        })
        .strict(),
    ),
    confirmedDevolutionScenarioId: z.string().nullable(),
    latestCalculationRunId: z.string().nullable(),
  })
  .strict()
  .superRefine((snapshot, context) => {
    for (const [key, field] of Object.entries(snapshot.fields)) {
      if (key === canonicalFieldKey(field.fieldId, field.entityId, field.occurrenceId)) continue;
      context.addIssue({
        code: "custom",
        path: ["fields", key],
        message: "chiave del campo canonico incoerente",
      });
    }
  });

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
  if (!value || typeof value !== "object") throw new Error("DECLARATION_SCHEMA_INVALID");
  if ((value as { schemaVersion?: unknown }).schemaVersion !== CURRENT_DECLARATION_SCHEMA)
    throw new Error("DECLARATION_SCHEMA_UNSUPPORTED");
  const parsed = declarationSnapshotSchema.safeParse(value);
  if (!parsed.success) throw new Error("DECLARATION_SCHEMA_INVALID");
  return parsed.data;
}

export function canonicalFieldKey(
  fieldId: string,
  entityId: string | null = null,
  occurrenceId: string | null = null,
): string {
  if (entityId && occurrenceId) return `${fieldId}::entity:${entityId}::occurrence:${occurrenceId}`;
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
