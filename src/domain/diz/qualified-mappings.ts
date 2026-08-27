import formFieldsCatalog from "../official-catalog/form-fields.json" with { type: "json" };

import type { DizFieldLocator } from "./xstream.ts";

export type QualifiedDizFieldMapping = {
  readonly status: "qualified";
  readonly dizCode: string;
  readonly catalogFieldId: string;
  readonly officialPath: string;
  readonly sourceIds: readonly string[];
  readonly evidence: {
    readonly method: "one-field-official-round-trip";
    readonly platform: "macOS";
    readonly software: "SuccessioniOnLine";
    readonly softwareVersion: string;
    readonly verifiedOn: string;
  };
};

export type QualifiedCatalogField = {
  readonly id: string;
  readonly technicalPath: string;
  readonly maxLength: number;
  readonly sourceIds: readonly string[];
  readonly status: "qualified-for-diz";
};

function qualifiedCatalogField(fieldId: string): QualifiedCatalogField {
  const field = formFieldsCatalog.fields.find((candidate) => candidate.id === fieldId);
  if (
    !field ||
    field.status !== "qualified-for-diz" ||
    typeof field.maxLength !== "number" ||
    !Number.isSafeInteger(field.maxLength) ||
    field.maxLength <= 0 ||
    !field.technicalPath.startsWith("/") ||
    !field.sourceIds.includes("SRC-08")
  ) {
    throw new Error("catalogo ufficiale: campo DIZ qualificato assente o incompleto");
  }
  return field as QualifiedCatalogField;
}

const QUALIFIED_COGNOME = qualifiedCatalogField("quadro-ea.soggetto.dati-anagrafici.cognome");

export const QUALIFIED_DIZ_FIELD_MAPPINGS = [
  {
    status: "qualified",
    dizCode: "EA001005",
    catalogFieldId: QUALIFIED_COGNOME.id,
    officialPath: QUALIFIED_COGNOME.technicalPath,
    sourceIds: ["SRC-08"],
    evidence: {
      method: "one-field-official-round-trip",
      platform: "macOS",
      software: "SuccessioniOnLine",
      softwareVersion: "2.3.1",
      verifiedOn: "2026-08-24",
    },
  },
] as const satisfies readonly QualifiedDizFieldMapping[];

export function qualifiedMappingFor(
  locator: DizFieldLocator,
): QualifiedDizFieldMapping | undefined {
  const dizCode = `${locator.quadro}${locator.field}`;
  return QUALIFIED_DIZ_FIELD_MAPPINGS.find((mapping) => mapping.dizCode === dizCode);
}

export function catalogFieldForMapping(mapping: QualifiedDizFieldMapping): QualifiedCatalogField {
  const field = qualifiedCatalogField(mapping.catalogFieldId);
  if (
    field.technicalPath !== mapping.officialPath ||
    !mapping.sourceIds.every((sourceId) => field.sourceIds.includes(sourceId))
  ) {
    throw new Error("catalogo ufficiale: mapping DIZ divergente dal campo qualificato");
  }
  return field;
}
