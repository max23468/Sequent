export type FieldNecessityKind =
  | "required"
  | "contextual"
  | "alternative"
  | "conditional"
  | "automatic"
  | "read-only"
  | "missing";

interface NecessityField {
  entryMode: string;
  operationalParity: {
    applicability: {
      choiceGroup: string | null;
      xsdPresence: "obbligatorio-nel-contesto" | "condizionale";
    };
    cardinality: { effectiveMin: number };
  };
}

interface FieldIssue {
  id: string;
  fieldId: string | null;
  entityId?: string | null;
}

export function isMissingRequiredField(
  issue: FieldIssue,
  fieldId: string,
  entityId: string | null,
  occurrenceId: string | null,
): boolean {
  if (!issue.id.startsWith("REQUIRED_FIELD_MISSING:") || issue.fieldId !== fieldId) return false;
  if (occurrenceId) return issue.id.endsWith(`:${occurrenceId}`);
  if (entityId) return issue.entityId === entityId;
  return issue.entityId == null;
}

export function fieldNecessityKind(
  field: NecessityField,
  options: { readOnly: boolean; automatic: boolean; missing: boolean },
): FieldNecessityKind {
  if (options.missing) return "missing";
  if (options.readOnly || field.entryMode === "derived")
    return options.automatic || field.entryMode === "derived" ? "automatic" : "read-only";
  if (field.operationalParity.applicability.choiceGroup !== null) return "alternative";
  if (
    field.operationalParity.applicability.xsdPresence === "obbligatorio-nel-contesto" &&
    field.operationalParity.cardinality.effectiveMin === 0
  )
    return "contextual";
  return field.operationalParity.applicability.xsdPresence === "obbligatorio-nel-contesto"
    ? "required"
    : "conditional";
}

export function fieldNecessityLabel(kind: FieldNecessityKind): string {
  return {
    required: "Obbligatorio",
    contextual: "Obbligatorio se applicabile",
    alternative: "Alternativa",
    conditional: "Solo se pertinente",
    automatic: "Automatico",
    "read-only": "Sola lettura",
    missing: "Da compilare",
  }[kind];
}

export function fieldRequirementSummary(fields: NecessityField[]): string {
  const required = fields.filter(
    (field) =>
      field.operationalParity.applicability.xsdPresence === "obbligatorio-nel-contesto" &&
      field.operationalParity.applicability.choiceGroup === null,
  ).length;
  const alternatives = fields.filter(
    (field) => field.operationalParity.applicability.choiceGroup !== null,
  ).length;
  const conditional = fields.length - required - alternatives;
  return [
    required > 0 ? `${required} obbligator${required === 1 ? "io" : "i"}` : null,
    alternatives > 0 ? `${alternatives} in alternativa` : null,
    conditional > 0 ? `${conditional} solo se pertinent${conditional === 1 ? "e" : "i"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function isConditionallyApplicableGroup(fields: NecessityField[]): boolean {
  return fields.every((field) => field.operationalParity.cardinality.effectiveMin === 0);
}
