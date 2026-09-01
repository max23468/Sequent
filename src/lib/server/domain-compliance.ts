import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { SUCCESSION_TAX_RULESET_VERSION } from "../../domain/calculation-types.ts";
import controlQualification from "../../domain/official-catalog/suc13-control-qualification.json" with { type: "json" };
import {
  createEmptyDeclaration,
  getCanonicalField,
  parseDeclaration,
  type DeclarationSnapshot,
} from "../../domain/declaration.ts";
import {
  getCatalogField,
  getCatalogStatus,
  getQuadroActivationRootPath,
  listQuadroFields,
  listQuadroTechnicalElements,
  QUADRI,
  type QuadroId,
  type TechnicalElement,
} from "../../domain/official-catalog/catalog.ts";
import { TEMPORAL_RULESET_VERSION } from "../../domain/temporal-rules.ts";
import {
  validateDeclaration,
  validateRepeatedEaSubjects,
  type ValidationIssue,
} from "../../domain/validation.ts";
import { getDeclaration } from "./practices.ts";
import { listOfficialAttachments } from "./official-attachments.ts";
import { listSharedAssets } from "./domain-assets.ts";
import { synchronizeChecklist } from "./domain-checklist.ts";
import { buildOfficialEgAttachmentState } from "./successionionline-eg-attachments.ts";
import { listDeclarationSubjectEntries, listSharedSubjects } from "./domain-subjects.ts";
import { successionOpeningDateDivergenceIssue, type ChecklistItem } from "./domain-model.ts";

type QuadroField = ReturnType<typeof listQuadroFields>[number];

function parentTechnicalPath(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

function isTechnicalDescendant(path: string, ancestor: string): boolean {
  return path.startsWith(`${ancestor}/`);
}

function requiredFieldIssues(
  database: Database.Database,
  practiceId: string,
  declarationId: string,
  declaration: DeclarationSnapshot,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const subjects = listDeclarationSubjectEntries(database, practiceId, declarationId);
  const decedent = listSharedSubjects(database, practiceId).find(
    (subject) => subject.role === "decedent",
  );
  const assets = listSharedAssets(database, practiceId, declarationId);
  const entityNames = new Map<string, string>([
    ...subjects.map((subject) => [subject.id, subject.displayName] as const),
    ...(decedent ? [[decedent.id, decedent.displayName] as const] : []),
    ...assets.map((asset) => [asset.id, asset.displayName] as const),
  ]);
  type ActiveContext = {
    quadro: QuadroId;
    entityId: string | null;
    occurrenceId: string | null;
    occurrenceGroup: string | null;
    scope: "standard" | "declaration" | "occurrence";
  };
  const active: ActiveContext[] = [
    {
      quadro: "Frontespizio",
      entityId: null,
      occurrenceId: null,
      occurrenceGroup: null,
      scope: "standard",
    },
    ...subjects.map((subject): ActiveContext => ({
      quadro: "EA",
      entityId: subject.id,
      occurrenceId: null,
      occurrenceGroup: null,
      scope: "standard",
    })),
  ];
  for (const asset of assets) {
    if (!asset.quadro) continue;
    active.push({
      quadro: asset.quadro,
      entityId: asset.id,
      occurrenceId: null,
      occurrenceGroup: null,
      scope: "standard",
    });
  }
  const entityQuadri = new Set<QuadroId>([
    "Frontespizio",
    "EA",
    "EB",
    "EC",
    "ED",
    "EL",
    "EM",
    "EN",
    "EO",
    "EP",
    "EQ",
    "ER",
  ]);
  const staticQuadri = new Set<QuadroId>(QUADRI.filter((quadro) => !entityQuadri.has(quadro)));
  const activeKeys = new Set(active.map((context) => JSON.stringify(context)));
  const addActiveContext = (context: ActiveContext): void => {
    const key = JSON.stringify(context);
    if (activeKeys.has(key)) return;
    activeKeys.add(key);
    active.push(context);
  };
  for (const storedField of Object.values(declaration.fields)) {
    if (
      storedField.value === null ||
      storedField.value === undefined ||
      String(storedField.value) === ""
    )
      continue;
    const catalogField = getCatalogField(storedField.fieldId);
    const quadro = catalogField?.quadro as QuadroId | undefined;
    if (!quadro || !staticQuadri.has(quadro)) continue;
    if (catalogField?.entityScope === "occurrence") {
      const occurrenceGroup = catalogField.occurrenceGroup ?? null;
      if (!storedField.occurrenceId || !occurrenceGroup) continue;
      addActiveContext({
        quadro,
        entityId: null,
        occurrenceId: storedField.occurrenceId,
        occurrenceGroup,
        scope: "occurrence",
      });
      continue;
    }
    addActiveContext({
      quadro,
      entityId: null,
      occurrenceId: null,
      occurrenceGroup: null,
      scope: "declaration",
    });
  }
  const occurrencePositions = new Map<string, number>();
  const occurrenceCounts = new Map<string, number>();
  for (const context of active.filter((candidate) => candidate.scope === "occurrence")) {
    const group = `${context.quadro}:${context.occurrenceGroup}`;
    const position = (occurrenceCounts.get(group) ?? 0) + 1;
    occurrenceCounts.set(group, position);
    occurrencePositions.set(`${group}:${context.occurrenceId}`, position);
  }
  for (const context of active) {
    const fields = listQuadroFields(context.quadro).filter(
      (field) =>
        field.entryMode !== "derived" &&
        (field.appliesToDeclarationKinds.length === 0 ||
          field.appliesToDeclarationKinds.includes(declaration.declarationKind)) &&
        (context.scope === "standard" ||
          (context.scope === "declaration" && field.entityScope === "declaration") ||
          (context.scope === "occurrence" &&
            field.entityScope === "occurrence" &&
            field.occurrenceGroup === context.occurrenceGroup)),
    );
    const rootPath =
      context.scope === "occurrence"
        ? context.occurrenceGroup!
        : getQuadroActivationRootPath(context.quadro);
    const technicalElements = listQuadroTechnicalElements(context.quadro).filter(
      (element) =>
        context.scope !== "occurrence" ||
        element.path === rootPath ||
        isTechnicalDescendant(element.path, rootPath),
    );
    const fieldsByPath = new Map(fields.map((field) => [field.path, field]));
    {
      const contextEntityId = context.entityId;
      const contextIdentity = context.occurrenceId ?? contextEntityId ?? "declaration";
      const occurrencePosition =
        context.scope === "occurrence"
          ? occurrencePositions.get(
              `${context.quadro}:${context.occurrenceGroup}:${context.occurrenceId}`,
            )
          : undefined;
      const declarationLocation =
        occurrencePosition !== undefined
          ? `nella posizione ${occurrencePosition} del Quadro ${context.quadro}`
          : `nel ${context.quadro === "Frontespizio" ? "Frontespizio" : `Quadro ${context.quadro}`}`;
      const entityIdFor = (field: QuadroField): string | null =>
        field.entityScope === "decedent" ? (decedent?.id ?? null) : contextEntityId;
      const hasValue = (field: QuadroField): boolean => {
        const value = getCanonicalField(
          declaration,
          field.canonicalId,
          entityIdFor(field),
          field.entityScope === "occurrence" ? context.occurrenceId : null,
        )?.value;
        return value !== null && value !== undefined && String(value) !== "";
      };
      const activeContainers = new Set<string>([rootPath]);
      for (const field of fields.filter(
        (candidate) =>
          hasValue(candidate) ||
          (candidate.minOccurs > 0 && candidate.appliesToDeclarationKinds.length > 0),
      )) {
        let path = parentTechnicalPath(field.path);
        while (path.length >= rootPath.length) {
          activeContainers.add(path);
          if (path === rootPath) break;
          path = parentTechnicalPath(path);
        }
      }
      let activated = true;
      while (activated) {
        activated = false;
        for (const element of technicalElements) {
          if (
            element.kind !== "container" ||
            element.path === rootPath ||
            element.choiceGroup !== null ||
            activeContainers.has(element.path) ||
            !activeContainers.has(parentTechnicalPath(element.path))
          )
            continue;
          if (element.minOccurs === 0) continue;
          activeContainers.add(element.path);
          activated = true;
        }
      }
      const choices = new Map<string, TechnicalElement[]>();
      for (const element of technicalElements) {
        if (!element.choiceGroup) continue;
        if (
          (element.kind === "field" && !fieldsByPath.has(element.path)) ||
          (element.kind === "container" &&
            !fields.some((field) => isTechnicalDescendant(field.path, element.path)))
        )
          continue;
        const members = choices.get(element.choiceGroup) ?? [];
        members.push(element);
        choices.set(element.choiceGroup, members);
      }
      for (const [choiceGroup, members] of choices) {
        const parentPath = parentTechnicalPath(members[0]?.path ?? "");
        const selected = members.filter((member) => {
          if (member.kind === "field") {
            const field = fieldsByPath.get(member.path);
            return field ? hasValue(field) : false;
          }
          return fields.some(
            (field) => isTechnicalDescendant(field.path, member.path) && hasValue(field),
          );
        });
        const choiceIsActive = activeContainers.has(parentPath) || selected.length > 0;
        if (!choiceIsActive) continue;
        const firstField =
          members
            .map((member) =>
              member.kind === "field"
                ? fieldsByPath.get(member.path)
                : fields.find((field) => isTechnicalDescendant(field.path, member.path)),
            )
            .find(Boolean) ?? null;
        if (selected.length === 0 && members.some((member) => member.minOccurs > 0))
          issues.push({
            id: `REQUIRED_CHOICE_MISSING:${choiceGroup}:${contextIdentity}`,
            level: "blocking",
            fieldId: firstField?.canonicalId ?? null,
            entityId: contextEntityId,
            message: contextEntityId
              ? `Scegli una delle alternative previste per ${entityNames.get(contextEntityId) ?? "la posizione interessata"}.`
              : `Scegli una delle alternative previste ${declarationLocation}.`,
            sourceId: firstField?.sourceId ?? members[0]!.sourceId,
            sourcePointer: firstField?.sourcePointer ?? members[0]!.sourcePointer,
          });
        if (selected.length > 1)
          issues.push({
            id: `CHOICE_EXCLUSIVITY_VIOLATION:${choiceGroup}:${contextIdentity}`,
            level: "blocking",
            fieldId: firstField?.canonicalId ?? null,
            entityId: contextEntityId,
            message: contextEntityId
              ? `Mantieni una sola alternativa per ${entityNames.get(contextEntityId) ?? "la posizione interessata"}.`
              : `Mantieni una sola alternativa ${declarationLocation}.`,
            sourceId: firstField?.sourceId ?? members[0]!.sourceId,
            sourcePointer: firstField?.sourcePointer ?? members[0]!.sourcePointer,
          });
      }
      for (const field of fields) {
        if (
          field.choiceGroup !== null ||
          !activeContainers.has(parentTechnicalPath(field.path)) ||
          field.minOccurs === 0 ||
          hasValue(field)
        )
          continue;
        const entityId = entityIdFor(field);
        issues.push({
          id: `REQUIRED_FIELD_MISSING:${field.canonicalId}:${contextIdentity}`,
          level: "blocking",
          fieldId: field.canonicalId,
          entityId,
          message: entityId
            ? `Completa “${field.label}” per ${entityNames.get(entityId) ?? "la posizione interessata"}.`
            : `Completa “${field.label}” ${declarationLocation}.`,
          sourceId: field.sourceId,
          sourcePointer: field.sourcePointer,
        });
      }
    }
  }
  return issues;
}

export function buildComplianceReport(
  database: Database.Database,
  practiceId: string,
  declarationId: string,
): {
  declaration: DeclarationSnapshot;
  issues: ValidationIssue[];
  checklist: ChecklistItem[];
  qualification: {
    sourceBundleId: string;
    catalogVersion: string;
    calculationRulesVersion: string;
    temporalRulesVersion: string;
    validatorVersion: string;
    quadriPresent: string[];
    officialControl: {
      name: string;
      version: string;
      status: string;
      blockingDiagnostics: number;
    };
    attachments: {
      files: number;
      totalBytes: number;
      formats: string[];
      motivatedExceptions: number;
    };
  };
  ready: boolean;
  digest: string;
} {
  const record = getDeclaration(database, declarationId, practiceId);
  const declaration = record?.declaration ?? createEmptyDeclaration();
  const entries = listDeclarationSubjectEntries(database, practiceId, declarationId);
  const assets = listSharedAssets(database, practiceId, declarationId).filter(
    (asset) => asset.kind !== "donation",
  );
  const entityNames = new Map<string, string>([
    ...listSharedSubjects(database, practiceId).map(
      (subject) => [subject.id, subject.displayName] as const,
    ),
    ...entries.map((entry) => [entry.id, entry.displayName] as const),
    ...assets.map((asset) => [asset.id, asset.displayName] as const),
  ]);
  const issues = [
    ...validateDeclaration(declaration).map((issue) => {
      const entityName = issue.entityId ? entityNames.get(issue.entityId) : null;
      if (!entityName) return issue;
      const label = issue.fieldId ? getCatalogField(issue.fieldId)?.label : null;
      return {
        ...issue,
        message: issue.id.startsWith("PROFESSIONAL_CONFIRMATION_REQUIRED:")
          ? `Conferma professionalmente “${label ?? "questo dato"}” per ${entityName}.`
          : `${issue.message.replace(/\.$/, "")} per ${entityName}.`,
      };
    }),
    ...validateRepeatedEaSubjects(declaration, entries),
    ...requiredFieldIssues(database, practiceId, declarationId, declaration),
  ];
  const openingDateIssue = successionOpeningDateDivergenceIssue(declaration);
  if (openingDateIssue) issues.push(openingDateIssue);
  if (getCatalogStatus().status !== "qualified") {
    issues.push({
      id: "OFFICIAL_RULES_INCOMPLETE",
      level: "blocking",
      fieldId: null,
      message: "Le fonti ministeriali non sono ancora completamente riconciliate.",
      sourceId: "SRC-03/SRC-08",
      sourcePointer: "official-catalog.json",
    });
  }
  const checklist = synchronizeChecklist(database, practiceId, declarationId);
  if (checklist.some((item) => item.importance === "blocking" && item.status === "missing")) {
    issues.push({
      id: "CHECKLIST_BLOCKING_MISSING",
      level: "blocking",
      fieldId: null,
      message: "Manca almeno un documento obbligatorio per questa dichiarazione.",
      sourceId: "SRC-05",
      sourcePointer: "checklist_items",
    });
  }
  const officialAttachments = listOfficialAttachments(database, practiceId);
  const officialEgAttachments = buildOfficialEgAttachmentState(database, practiceId, checklist);
  const preparedDocumentIds = new Set(
    officialAttachments.map((attachment) => attachment.documentId),
  );
  const unpreparedAttachments = checklist.filter(
    (item) =>
      item.requirementKind === "attachment" &&
      item.status === "available" &&
      (!item.documentId || !preparedDocumentIds.has(item.documentId)),
  );
  if (unpreparedAttachments.length > 0)
    issues.push({
      id: "OFFICIAL_ATTACHMENTS_NOT_PREPARED",
      level: "blocking",
      fieldId: null,
      message:
        "Almeno un documento da allegare non è ancora stato trasformato e controllato come PDF/A-1b o TIFF.",
      sourceId: "SRC-07/SRC-08/SRC-09",
      sourcePointer: "allegati PDF/A-1b o TIFF, 5 MB per file e 40 MB complessivi",
    });
  if (!officialEgAttachments.ready)
    issues.push({
      id: "OFFICIAL_ATTACHMENTS_EG_CLASSIFICATION_REQUIRED",
      level: "blocking",
      fieldId: null,
      message:
        "La destinazione nel Quadro EG di almeno un allegato è assente o ambigua. Ogni documento preparato deve appartenere a un solo contenitore ufficiale.",
      sourceId: "SRC-08/SuccessioniOnLine-SUC13",
      sourcePointer: "Quadro EG — contenitori EG1-EG11",
    });
  if (assets.length > 0 && !declaration.confirmedDevolutionScenarioId)
    issues.push({
      id: "DEVOLUTION_CONFIRMATION_REQUIRED",
      level: "blocking",
      fieldId: null,
      message: "Conferma la ripartizione dei beni e delle passività.",
      sourceId: "SRC-05/SRC-10",
      sourcePointer: "devolution_scenarios",
    });
  if (
    assets.length > 0 &&
    declaration.successionOpenedAt !== null &&
    declaration.successionOpenedAt >= "2025-01-01" &&
    !declaration.latestCalculationRunId
  )
    issues.push({
      id: "CALCULATION_CONFIRMATION_REQUIRED",
      level: "blocking",
      fieldId: null,
      message: "Esegui e conferma il calcolo dell’imposta.",
      sourceId: "SRC-10",
      sourcePointer: "calculation_runs",
    });
  const uniqueIssues = [
    ...new Map(
      issues.map((issue) => [
        `${issue.level}:${issue.message}:${issue.sourceId}:${issue.sourcePointer}`,
        issue,
      ]),
    ).values(),
  ];
  const quadriPresent = [
    ...new Set(
      Object.values(declaration.fields)
        .filter(
          (field) =>
            field.state !== "not_applicable" &&
            field.value !== null &&
            field.value !== undefined &&
            field.value !== "",
        )
        .map((field) => getCatalogField(field.fieldId)?.quadro)
        .filter((quadro): quadro is string => Boolean(quadro)),
    ),
  ].sort((left, right) => QUADRI.indexOf(left as QuadroId) - QUADRI.indexOf(right as QuadroId));
  const qualification = {
    sourceBundleId: declaration.officialSourceBundleId,
    catalogVersion: declaration.catalogVersion,
    calculationRulesVersion: SUCCESSION_TAX_RULESET_VERSION,
    temporalRulesVersion: TEMPORAL_RULESET_VERSION,
    validatorVersion: declaration.validatorVersion,
    quadriPresent,
    officialControl: {
      name: controlQualification.control.name,
      version: controlQualification.control.version,
      status: controlQualification.status,
      blockingDiagnostics: controlQualification.result.blockingDiagnostics.length,
    },
    attachments: {
      files: officialAttachments.length,
      totalBytes: officialAttachments.reduce((sum, attachment) => sum + attachment.byteSize, 0),
      formats: [...new Set(officialAttachments.map((attachment) => attachment.format))].sort(),
      motivatedExceptions: checklist.filter((item) => item.status === "overridden").length,
    },
  };
  const canonical = JSON.stringify({
    declaration,
    issues: uniqueIssues,
    checklist,
    preparedAttachments: [...preparedDocumentIds].sort(),
    qualification,
  });
  return {
    declaration: parseDeclaration(declaration),
    issues: uniqueIssues,
    checklist,
    qualification,
    ready: !uniqueIssues.some((issue) => issue.level === "blocking"),
    digest: createHash("sha256").update(canonical).digest("hex"),
  };
}
