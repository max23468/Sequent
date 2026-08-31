import type Database from "better-sqlite3";
import {
  dizMappingIdentity,
  dizMappingOccurrenceId,
  dizModuleSequence,
  importMappingFor,
  isKnownConverterOnlyField,
  type DizImportMapping,
} from "../../domain/diz/index.ts";
import type { DizField } from "../../domain/diz/xstream.ts";
import { getCanonicalField, setCanonicalField } from "../../domain/declaration.ts";
import { createSharedAsset, listSharedAssets } from "./domain-assets.ts";
import type { AssetKind } from "./domain-model.ts";
import {
  createSharedSubject,
  listDeclarationSubjectEntries,
  listSharedSubjects,
  synchronizeCanonicalSubjectIdentities,
} from "./domain-subjects.ts";
import { getDeclaration, saveDeclaration } from "./practices.ts";

export interface DizAcquisitionSummary {
  version: 3;
  sourceFields: number;
  nonEmptyFields: number;
  mappedFields: number;
  importedFields: number;
  unchangedFields: number;
  conflictingFields: number;
  missingTargets: number;
  converterOnlyFields: number;
  opaqueFields: number;
  preservedFields: number;
  createdSubjects: number;
  createdAssets: number;
  createdDecedent: boolean;
  synchronizedSubjectEntries: number;
  synchronizedSharedSubjects: number;
  subjectIdentityConflicts: number;
  targetBindings: Record<string, string>;
}

interface MappedSourceField {
  field: DizField;
  mapping: DizImportMapping;
  identity: string;
  occurrenceId: string | null;
}

const ASSET_KIND_BY_QUADRO: Partial<Record<string, AssetKind>> = {
  EB: "land",
  EC: "building",
  ED: "liability",
  EL: "tavolare_land",
  EM: "tavolare_building",
  EN: "company",
  EO: "securities",
  EP: "aircraft",
  EQ: "vessel",
};

function assertDeclaration(database: Database.Database, practiceId: string, declarationId: string) {
  const record = getDeclaration(database, declarationId, practiceId);
  if (!record) throw new Error("DECLARATION_NOT_FOUND");
  return record;
}

function fieldValue(rows: readonly MappedSourceField[], fieldId: string): string {
  return rows.find((row) => row.mapping.catalogFieldId === fieldId)?.field.value.trim() ?? "";
}

function fieldValueByPathSuffix(rows: readonly MappedSourceField[], suffix: string): string {
  return rows.find((row) => row.mapping.technicalPath.endsWith(suffix))?.field.value.trim() ?? "";
}

function subjectLabel(rows: readonly MappedSourceField[], ordinal: number): string {
  const denomination = fieldValue(rows, "quadro-ea.soggetto.denominazione");
  if (denomination) return denomination;
  const surname = fieldValue(rows, "quadro-ea.soggetto.dati-anagrafici.cognome");
  const name = fieldValue(rows, "quadro-ea.soggetto.nome");
  return [surname, name].filter(Boolean).join(" ") || `Soggetto DIZ ${ordinal}`;
}

function decedentLabel(rows: readonly MappedSourceField[]): string {
  const surname = fieldValueByPathSuffix(rows, "/DatiDefunto/DatiAnagrafici/Cognome");
  const name = fieldValueByPathSuffix(rows, "/DatiDefunto/DatiAnagrafici/Nome");
  return [surname, name].filter(Boolean).join(" ") || "Defunto da DIZ";
}

function assetKind(rows: readonly MappedSourceField[]): AssetKind {
  const quadro = rows[0]?.mapping.quadro ?? "";
  if (quadro !== "ER") return ASSET_KIND_BY_QUADRO[quadro] ?? "other";
  const type = fieldValueByPathSuffix(rows, "/TipoCespite");
  if (type === "BI") return "inventory";
  if (type === "DN") return "money";
  return "other";
}

function assetLabel(rows: readonly MappedSourceField[], ordinal: number): string {
  const quadro = rows[0]?.mapping.quadro ?? "";
  const description = fieldValueByPathSuffix(rows, "/Descrizione");
  const address = fieldValueByPathSuffix(rows, "/Luogo/Italia/Indirizzo");
  const parcel = fieldValueByPathSuffix(rows, "/DatiCatastali/Particella");
  return description || address || parcel || `Quadro ${quadro} · cespite ${ordinal}`;
}

function assetValueCents(rows: readonly MappedSourceField[]): bigint {
  const value = fieldValueByPathSuffix(rows, "/Valore");
  return /^\d+$/u.test(value) ? BigInt(value) * 100n : 0n;
}

function validBoundTarget(
  scope: DizImportMapping["entityScope"],
  targetId: string | undefined,
  subjectEntryIds: ReadonlySet<string>,
  assetIds: ReadonlySet<string>,
  decedentIds: ReadonlySet<string>,
): string | null {
  if (!targetId) return null;
  if (scope === "subject" && subjectEntryIds.has(targetId)) return targetId;
  if (scope === "asset" && assetIds.has(targetId)) return targetId;
  if (scope === "decedent" && decedentIds.has(targetId)) return targetId;
  return null;
}

function groupMappedFields(rows: readonly MappedSourceField[]): Map<string, MappedSourceField[]> {
  const groups = new Map<string, MappedSourceField[]>();
  for (const row of rows) {
    if (!["subject", "asset", "decedent"].includes(row.mapping.entityScope)) continue;
    const group = groups.get(row.identity) ?? [];
    group.push(row);
    groups.set(row.identity, group);
  }
  return groups;
}

function ensureTargets(
  database: Database.Database,
  input: { practiceId: string; declarationId: string },
  rows: readonly MappedSourceField[],
  priorBindings: Readonly<Record<string, string>>,
): {
  bindings: Record<string, string>;
  createdSubjects: number;
  createdAssets: number;
  createdDecedent: boolean;
} {
  const bindings: Record<string, string> = {};
  let createdSubjects = 0;
  let createdAssets = 0;
  let createdDecedent = false;
  let subjectEntries = listDeclarationSubjectEntries(
    database,
    input.practiceId,
    input.declarationId,
  );
  const legacySubjectEntries = [...subjectEntries];
  let assets = listSharedAssets(database, input.practiceId, input.declarationId);
  let decedents = listSharedSubjects(database, input.practiceId).filter(
    (subject) => subject.role === "decedent",
  );
  const claimedTargets = new Set<string>();
  const groups = [...groupMappedFields(rows)].sort(([left], [right]) => left.localeCompare(right));

  for (const [identity, group] of groups) {
    const scope = group[0]!.mapping.entityScope;
    let target = validBoundTarget(
      scope,
      priorBindings[identity],
      new Set(subjectEntries.map((entry) => entry.id)),
      new Set(assets.map((asset) => asset.id)),
      new Set(decedents.map((subject) => subject.id)),
    );
    if (target && claimedTargets.has(target)) target = null;

    if (!target && scope === "decedent") {
      target = decedents[0]?.id ?? null;
      if (!target) {
        const decedent = createSharedSubject(database, input.practiceId, {
          role: "decedent",
          displayName: decedentLabel(group),
          taxCode: fieldValueByPathSuffix(group, "/CodiceFiscaleDefunto") || null,
          declarationId: input.declarationId,
        });
        target = decedent.id;
        decedents = [...decedents, decedent];
        createdDecedent = true;
      }
    }

    if (!target && scope === "subject") {
      const entitySlot = group[0]!.mapping.indexedContainers[0]?.index ?? 1;
      const module = dizModuleSequence(group[0]!.field.module);
      const legacyTarget =
        entitySlot === 1 && module !== null
          ? legacySubjectEntries.find(
              (entry) => entry.sequence === module && !claimedTargets.has(entry.id),
            )
          : null;
      target = legacyTarget?.id ?? null;
      if (!target) {
        const subject = createSharedSubject(database, input.practiceId, {
          role: "beneficiary",
          displayName: subjectLabel(group, subjectEntries.length + 1),
          taxCode: fieldValue(group, "quadro-ea.soggetto.codice-fiscale") || null,
          declarationId: input.declarationId,
        });
        subjectEntries = listDeclarationSubjectEntries(
          database,
          input.practiceId,
          input.declarationId,
        );
        target = subjectEntries.find((entry) => entry.subjectId === subject.id)?.id ?? null;
        createdSubjects += 1;
      }
    }

    if (!target && scope === "asset") {
      const asset = createSharedAsset(database, input.practiceId, {
        kind: assetKind(group),
        displayName: assetLabel(group, assets.length + 1),
        valueCents: assetValueCents(group),
        declarationId: input.declarationId,
      });
      target = asset.id;
      assets = [...assets, asset];
      createdAssets += 1;
    }

    if (!target) throw new Error("DIZ_IMPORT_TARGET_CREATION_FAILED");
    bindings[identity] = target;
    claimedTargets.add(target);
  }
  return { bindings, createdSubjects, createdAssets, createdDecedent };
}

export function acquireDizFields(
  database: Database.Database,
  input: { practiceId: string; declarationId: string },
  fields: readonly DizField[],
  sourceSha256: string,
  priorBindings: Readonly<Record<string, string>> = {},
): DizAcquisitionSummary {
  const nonEmptyFields = fields.filter((field) => field.value.length > 0);
  const mapped: MappedSourceField[] = [];
  let converterOnlyFields = 0;
  let opaqueFields = 0;
  for (const field of nonEmptyFields) {
    const mapping = importMappingFor(field);
    if (mapping) {
      mapped.push({
        field,
        mapping,
        identity: dizMappingIdentity(field, mapping),
        occurrenceId: dizMappingOccurrenceId(field, mapping),
      });
    } else if (isKnownConverterOnlyField(field)) converterOnlyFields += 1;
    else opaqueFields += 1;
  }

  const targets = ensureTargets(database, input, mapped, priorBindings);
  const record = assertDeclaration(database, input.practiceId, input.declarationId);
  let declaration = record.declaration;
  let importedFields = 0;
  let unchangedFields = 0;
  let conflictingFields = 0;
  let missingTargets = 0;
  for (const row of mapped) {
    const entityId = ["subject", "asset", "decedent"].includes(row.mapping.entityScope)
      ? (targets.bindings[row.identity] ?? null)
      : null;
    if (["subject", "asset", "decedent"].includes(row.mapping.entityScope) && !entityId) {
      missingTargets += 1;
      continue;
    }
    const current = getCanonicalField(
      declaration,
      row.mapping.catalogFieldId,
      entityId,
      row.occurrenceId,
    );
    if (current) {
      if (String(current.value ?? "") === row.field.value) unchangedFields += 1;
      else conflictingFields += 1;
      continue;
    }
    declaration = setCanonicalField(
      declaration,
      row.mapping.catalogFieldId,
      row.field.value,
      "to_review",
      [
        `DIZ acquisito · SHA-256 ${sourceSha256}`,
        "SuccessioniOnLine 2.3.1 · proprietà ufficiali del convertitore SUC13",
      ],
      entityId,
      row.occurrenceId,
    );
    importedFields += 1;
  }
  if (importedFields > 0)
    saveDeclaration(database, input.declarationId, record.revision, declaration);
  const identitySynchronization = synchronizeCanonicalSubjectIdentities(
    database,
    input.practiceId,
    input.declarationId,
  );
  const preservedFields = converterOnlyFields + opaqueFields + conflictingFields + missingTargets;
  return {
    version: 3,
    sourceFields: fields.length,
    nonEmptyFields: nonEmptyFields.length,
    mappedFields: mapped.length,
    importedFields,
    unchangedFields,
    conflictingFields,
    missingTargets,
    converterOnlyFields,
    opaqueFields,
    preservedFields,
    createdSubjects: targets.createdSubjects,
    createdAssets: targets.createdAssets,
    createdDecedent: targets.createdDecedent,
    synchronizedSubjectEntries: identitySynchronization.synchronizedEntries,
    synchronizedSharedSubjects: identitySynchronization.synchronizedSubjects,
    subjectIdentityConflicts: identitySynchronization.conflictingSubjects,
    targetBindings: targets.bindings,
  };
}
