import type { DizField, DizFieldLocator } from "./xstream.ts";
import { qualifiedMappingFor } from "./qualified-mappings.ts";

export type ThreeWayValue = DizFieldLocator & {
  readonly base?: string;
  readonly current?: string;
  readonly official?: string;
};

export type ThreeWayFieldComparison = {
  readonly importFromOfficial: readonly ThreeWayValue[];
  readonly keepCurrent: readonly ThreeWayValue[];
  readonly unchanged: readonly ThreeWayValue[];
  readonly conflicts: readonly ThreeWayValue[];
  readonly opaque: readonly ThreeWayValue[];
};

function key(field: DizFieldLocator): string {
  return `${field.quadro}\u0000${field.module}\u0000${field.field}`;
}

function index(fields: readonly DizField[]): Map<string, DizField> {
  const result = new Map<string, DizField>();
  for (const field of fields) {
    const fieldKey = key(field);
    if (result.has(fieldKey)) throw new Error("confronto DIZ: localizzatore duplicato");
    result.set(fieldKey, field);
  }
  return result;
}

export function compareDizFields(
  baseFields: readonly DizField[],
  currentFields: readonly DizField[],
  officialFields: readonly DizField[],
): ThreeWayFieldComparison {
  const base = index(baseFields);
  const current = index(currentFields);
  const official = index(officialFields);
  const keys = [...new Set([...base.keys(), ...current.keys(), ...official.keys()])].sort();
  const result: {
    importFromOfficial: ThreeWayValue[];
    keepCurrent: ThreeWayValue[];
    unchanged: ThreeWayValue[];
    conflicts: ThreeWayValue[];
    opaque: ThreeWayValue[];
  } = { importFromOfficial: [], keepCurrent: [], unchanged: [], conflicts: [], opaque: [] };

  for (const fieldKey of keys) {
    const baseField = base.get(fieldKey);
    const currentField = current.get(fieldKey);
    const officialField = official.get(fieldKey);
    const locator = baseField ?? currentField ?? officialField;
    if (!locator) continue;
    const comparison = {
      quadro: locator.quadro,
      module: locator.module,
      field: locator.field,
      base: baseField?.value,
      current: currentField?.value,
      official: officialField?.value,
    };
    if (comparison.current === comparison.official) result.unchanged.push(comparison);
    else if (!qualifiedMappingFor(comparison)) result.opaque.push(comparison);
    else if (comparison.current === comparison.base) result.importFromOfficial.push(comparison);
    else if (comparison.official === comparison.base) result.keepCurrent.push(comparison);
    else result.conflicts.push(comparison);
  }
  return result;
}
