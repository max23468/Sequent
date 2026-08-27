import {
  getCatalogField,
  getResolvedTechnicalFacets,
  getTechnicalField,
} from "./official-catalog/catalog.ts";
import { getCanonicalField, type DeclarationSnapshot } from "./declaration.ts";

export interface ValidationIssue {
  id: string;
  level: "blocking" | "warning";
  fieldId: string | null;
  entityId?: string | null;
  message: string;
  sourceId: string;
  sourcePointer: string;
}

function decimalDigits(value: string): { total: number; fraction: number } {
  const normalized = value.replace(/^[-+]/, "");
  const [integer = "", fraction = ""] = normalized.split(".");
  return { total: integer.replace(/^0+/, "").length + fraction.length, fraction: fraction.length };
}

export function validateFieldValue(fieldId: string, value: unknown): ValidationIssue[] {
  const field = getTechnicalField(fieldId);
  if (!field) {
    return [
      {
        id: "CATALOG_FIELD_UNKNOWN",
        level: "blocking",
        fieldId,
        message: "Il campo non appartiene ancora all’elenco verificato.",
        sourceId: "SRC-08",
        sourcePointer: "technical-schema.json",
      },
    ];
  }
  const text = typeof value === "string" ? value : String(value ?? "");
  const issues: ValidationIssue[] = [];
  const facets = getResolvedTechnicalFacets(fieldId);
  for (const pattern of facets.pattern ?? []) {
    let valid = false;
    try {
      valid = new RegExp(`^(?:${pattern})$`, "u").test(text);
    } catch {
      issues.push({
        id: "CATALOG_PATTERN_UNSUPPORTED",
        level: "blocking",
        fieldId,
        message: "Questo controllo richiede ancora una verifica specifica.",
        sourceId: field.sourceId,
        sourcePointer: field.sourcePointer,
      });
      continue;
    }
    if (!valid)
      issues.push({
        id: "XSD_PATTERN_MISMATCH",
        level: "blocking",
        fieldId,
        message: "Il valore non rispetta il formato previsto dall’Agenzia delle Entrate.",
        sourceId: field.sourceId,
        sourcePointer: field.sourcePointer,
      });
  }
  const length = [...text].length;
  const exactLength = Number(facets.length?.[0]);
  const minLength = Number(facets.minLength?.[0]);
  const maxLength = Number(facets.maxLength?.[0]);
  if (Number.isFinite(exactLength) && length !== exactLength)
    issues.push({
      id: "XSD_LENGTH_MISMATCH",
      level: "blocking",
      fieldId,
      message: `Il valore deve contenere ${exactLength} caratteri.`,
      sourceId: field.sourceId,
      sourcePointer: field.sourcePointer,
    });
  if (Number.isFinite(minLength) && length < minLength)
    issues.push({
      id: "XSD_MIN_LENGTH",
      level: "blocking",
      fieldId,
      message: `Il valore deve contenere almeno ${minLength} caratteri.`,
      sourceId: field.sourceId,
      sourcePointer: field.sourcePointer,
    });
  if (Number.isFinite(maxLength) && length > maxLength)
    issues.push({
      id: "XSD_MAX_LENGTH",
      level: "blocking",
      fieldId,
      message: `Il valore può contenere al massimo ${maxLength} caratteri.`,
      sourceId: field.sourceId,
      sourcePointer: field.sourcePointer,
    });
  const enumeration = facets.enumeration ?? [];
  if (enumeration.length > 0 && !enumeration.includes(text))
    issues.push({
      id: "XSD_ENUMERATION",
      level: "blocking",
      fieldId,
      message: "Il valore non appartiene all’elenco ammesso dall’Agenzia delle Entrate.",
      sourceId: field.sourceId,
      sourcePointer: field.sourcePointer,
    });
  const digits = decimalDigits(text);
  const totalDigits = Number(facets.totalDigits?.[0]);
  const fractionDigits = Number(facets.fractionDigits?.[0]);
  if (Number.isFinite(totalDigits) && digits.total > totalDigits)
    issues.push({
      id: "XSD_TOTAL_DIGITS",
      level: "blocking",
      fieldId,
      message: `Il valore può contenere al massimo ${totalDigits} cifre.`,
      sourceId: field.sourceId,
      sourcePointer: field.sourcePointer,
    });
  if (Number.isFinite(fractionDigits) && digits.fraction > fractionDigits)
    issues.push({
      id: "XSD_FRACTION_DIGITS",
      level: "blocking",
      fieldId,
      message: `Il valore può contenere al massimo ${fractionDigits} decimali.`,
      sourceId: field.sourceId,
      sourcePointer: field.sourcePointer,
    });
  return issues;
}

export function validateDeclaration(declaration: DeclarationSnapshot): ValidationIssue[] {
  const issues = Object.entries(declaration.fields).flatMap(([key, field]) =>
    field.state === "not_applicable" || field.state === "missing"
      ? []
      : validateFieldValue(field.fieldId, field.value).map((issue) => ({
          ...issue,
          id: `${issue.id}:${key}`,
          entityId: field.entityId,
        })),
  );
  for (const [key, field] of Object.entries(declaration.fields)) {
    if (["to_review", "conflict", "blocked"].includes(field.state)) {
      const technical = getTechnicalField(field.fieldId);
      const label = getCatalogField(field.fieldId)?.label ?? "questo dato";
      issues.push({
        id: `PROFESSIONAL_CONFIRMATION_REQUIRED:${key}`,
        level: "blocking",
        fieldId: field.fieldId,
        entityId: field.entityId,
        message: `Conferma professionalmente “${label}” prima dei documenti finali.`,
        sourceId: technical?.sourceId ?? "SRC-08",
        sourcePointer: technical?.sourcePointer ?? "technical-schema.json",
      });
    }
  }
  return issues;
}

const EA_TYPE = "quadro-ea.soggetto.tipo";
const EA_RELATIONSHIP = "quadro-ea.soggetto.grado-parentela";
const EA_DISABILITY = "quadro-ea.soggetto.disabilita";

function fieldText(declaration: DeclarationSnapshot, fieldId: string, entryId: string): string {
  const value = getCanonicalField(declaration, fieldId, entryId)?.value;
  return value === null || value === undefined ? "" : String(value);
}

export function validateRepeatedEaSubjects(
  declaration: DeclarationSnapshot,
  entries: Array<{ id: string; subjectId: string }>,
): ValidationIssue[] {
  const grouped = new Map<string, Array<{ id: string; subjectId: string }>>();
  for (const entry of entries) {
    const group = grouped.get(entry.subjectId) ?? [];
    group.push(entry);
    grouped.set(entry.subjectId, group);
  }
  const issues: ValidationIssue[] = [];
  for (const group of grouped.values()) {
    if (group.length < 2) continue;
    const typeValues = new Set(group.map((entry) => fieldText(declaration, EA_TYPE, entry.id)));
    const incompatibleTypes = ["1", "3", "4"].filter((value) => typeValues.has(value));
    if (incompatibleTypes.length > 1) {
      issues.push({
        id: "EA_REPEATED_SUBJECT_TYPE_CONFLICT",
        level: "blocking",
        fieldId: EA_TYPE,
        message:
          "Lo stesso beneficiario non può risultare contemporaneamente erede, chiamato o coniuge rinunciatario in posizioni diverse.",
        sourceId: "SRC-09",
        sourcePointer: "pagina 2, punto k — TipoSoggetto",
      });
    }
    const nonTrustEntries = group.filter(
      (entry) => fieldText(declaration, EA_TYPE, entry.id) !== "5",
    );
    if (nonTrustEntries.length < 2) continue;
    const relationshipValues = new Set(
      nonTrustEntries.map((entry) => fieldText(declaration, EA_RELATIONSHIP, entry.id)),
    );
    if (relationshipValues.size > 1) {
      issues.push({
        id: "EA_REPEATED_SUBJECT_RELATIONSHIP_MISMATCH",
        level: "blocking",
        fieldId: EA_RELATIONSHIP,
        message:
          "Le posizioni dello stesso beneficiario devono riportare lo stesso grado di parentela, salvo il caso del trust.",
        sourceId: "SRC-08/SRC-09",
        sourcePointer: "/Fornitura/Dichiarazione/QuadroEA/Modulo/Soggetto/GradoParentela",
      });
    }
    const disabilityValues = new Set(
      nonTrustEntries.map((entry) => fieldText(declaration, EA_DISABILITY, entry.id)),
    );
    if (disabilityValues.size > 1) {
      issues.push({
        id: "EA_REPEATED_SUBJECT_DISABILITY_MISMATCH",
        level: "blocking",
        fieldId: EA_DISABILITY,
        message:
          "Le posizioni dello stesso beneficiario devono riportare la stessa indicazione sulla disabilità, salvo il caso del trust.",
        sourceId: "SRC-09",
        sourcePointer: "pagina 3, punto p — PortatoreHandicap",
      });
    }
  }
  return issues;
}
