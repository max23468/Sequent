import importMappingsCatalog from "../official-catalog/diz-import-mappings.json" with { type: "json" };

import type { DizFieldLocator } from "./xstream.ts";

export type DizImportMapping = (typeof importMappingsCatalog.mappings)[number];
export type DizConverterOnlyMapping = (typeof importMappingsCatalog.converterOnlyMappings)[number];

const MAPPINGS_BY_CODE = new Map<string, DizImportMapping[]>();
for (const mapping of importMappingsCatalog.mappings) {
  const rows = MAPPINGS_BY_CODE.get(mapping.recordCode) ?? [];
  rows.push(mapping);
  MAPPINGS_BY_CODE.set(mapping.recordCode, rows);
}

const CONVERTER_ONLY_CODES = new Set(
  importMappingsCatalog.converterOnlyMappings.map((mapping) => mapping.recordCode),
);

export const DIZ_IMPORT_MAPPING_COUNTS = importMappingsCatalog.counts;
export const DIZ_IMPORT_MAPPING_SOURCE = importMappingsCatalog.source;

export function dizRecordCode(locator: DizFieldLocator): string {
  return `${locator.quadro}${locator.field}`;
}

export function dizModuleSequence(module: string): number | null {
  if (!/^\d{1,8}$/u.test(module)) return null;
  const sequence = Number.parseInt(module, 10);
  return Number.isSafeInteger(sequence) && sequence > 0 ? sequence : null;
}

function appliesToModule(mapping: DizImportMapping, module: string): boolean {
  if (mapping.moduleVariant === "any") return true;
  const sequence = dizModuleSequence(module);
  if (sequence === null) return false;
  return mapping.moduleVariant === "first" ? sequence === 1 : sequence > 1;
}

export function importMappingFor(locator: DizFieldLocator): DizImportMapping | undefined {
  const candidates = (MAPPINGS_BY_CODE.get(dizRecordCode(locator)) ?? []).filter((mapping) =>
    appliesToModule(mapping, locator.module),
  );
  if (candidates.length > 1) {
    const specific = candidates.filter((mapping) => mapping.moduleVariant !== "any");
    if (specific.length === 1) return specific[0];
  }
  if (candidates.length > 1) throw new Error("DIZ_IMPORT_MAPPING_AMBIGUOUS");
  return candidates[0];
}

export function isKnownConverterOnlyField(locator: DizFieldLocator): boolean {
  return CONVERTER_ONLY_CODES.has(dizRecordCode(locator));
}

export function dizMappingIdentity(locator: DizFieldLocator, mapping: DizImportMapping): string {
  const identityIndexes =
    mapping.entityScope === "subject" || mapping.entityScope === "asset"
      ? mapping.indexedContainers.slice(0, 1)
      : mapping.indexedContainers;
  const indexes = identityIndexes.map(({ name, index }) => `${name}:${index}`).join("/");
  return `${mapping.entityScope}:${mapping.quadro}:${locator.module}:${indexes || "single"}`;
}

export function dizMappingOccurrenceId(
  locator: DizFieldLocator,
  mapping: DizImportMapping,
): string | null {
  const entityIndexCount =
    mapping.entityScope === "subject" || mapping.entityScope === "asset" ? 1 : 0;
  const occurrenceIndexes = mapping.indexedContainers.slice(entityIndexCount);
  if (mapping.entityScope !== "occurrence" && occurrenceIndexes.length === 0) return null;
  const indexes = occurrenceIndexes.map(({ name, index }) => `${name}:${index}`).join("/");
  return `diz:${mapping.quadro}:${locator.module}:${indexes || "module"}`;
}
