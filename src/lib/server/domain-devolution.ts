import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { SUCCESSION_TAX_RULESET_VERSION } from "../../domain/calculation-types.ts";
import { getCanonicalField, type DeclarationSnapshot } from "../../domain/declaration.ts";
import { validateDevolutionScenario, type DevolutionIssue } from "../../domain/devolution.ts";
import { listTechnicalEnumerationValues } from "../../domain/official-catalog/catalog.ts";
import { getDeclaration, saveDeclaration } from "./practices.ts";
import { listSharedAssets } from "./domain-assets.ts";
import { listDeclarationSubjectEntries } from "./domain-subjects.ts";
import {
  allocateConservedCents,
  assetCatalogField,
  hasAmbiguousTaxPositions,
  officialAssetPreviousSuccessionField,
  officialAssetValueField,
  wholeEurosToCents,
  type DevolutionScenario,
} from "./domain-model.ts";
import { recordAuditEvent, serializeBigInts } from "./domain-write-support.ts";

function parseDevolutionShares(value: string): DevolutionScenario["shares"] {
  const rows = JSON.parse(value) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    assetId: String(row.assetId),
    beneficiaryId: String(row.beneficiaryId),
    numerator: BigInt(String(row.numerator)),
    denominator: BigInt(String(row.denominator)),
    rightCode: String(row.rightCode),
    valueCents: BigInt(String(row.valueCents)),
    reliefCode: String(row.reliefCode ?? ""),
    reductionYears: Number(row.reductionYears ?? 0) as 0 | 1 | 2 | 3 | 4 | 5,
    previousSuccessionValueCents: BigInt(String(row.previousSuccessionValueCents ?? 0)),
    foreignTaxCents: BigInt(String(row.foreignTaxCents ?? 0)),
  }));
}

export function listDevolutionScenarios(
  database: Database.Database,
  practiceId: string,
  declarationId: string,
): DevolutionScenario[] {
  const rows = database
    .prepare(
      `SELECT id, result_json, issues_json, status, updated_at
       FROM devolution_scenarios
       WHERE practice_id = ? AND declaration_id = ?
       ORDER BY updated_at DESC`,
    )
    .all(practiceId, declarationId) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    status: String(row.status) as DevolutionScenario["status"],
    shares: parseDevolutionShares(String(row.result_json)),
    issues: JSON.parse(String(row.issues_json)) as DevolutionIssue[],
    updatedAt: String(row.updated_at),
  }));
}

export function saveDevolutionScenario(
  database: Database.Database,
  input: {
    practiceId: string;
    declarationId: string;
    expectedRevision: number;
    shares: Array<{
      assetId: string;
      beneficiaryId: string;
      numerator: bigint;
      denominator: bigint;
      rightCode: string;
      reliefCode?: string;
      reductionYears?: 0 | 1 | 2 | 3 | 4 | 5;
      previousSuccessionValueCents?: bigint;
      foreignTaxCents?: bigint;
    }>;
  },
): DevolutionScenario {
  const declaration = getDeclaration(database, input.declarationId, input.practiceId);
  if (!declaration) throw new Error("DECLARATION_NOT_FOUND");
  if (declaration.revision !== input.expectedRevision) throw new Error("REVISION_CONFLICT");
  const assets = new Map(
    listSharedAssets(database, input.practiceId, input.declarationId).map((asset) => [
      asset.id,
      asset,
    ]),
  );
  const entries = listDeclarationSubjectEntries(database, input.practiceId, input.declarationId);
  const beneficiaries = new Set(
    entries.filter((entry) => entry.role === "beneficiary").map((entry) => entry.subjectId),
  );
  const issues: DevolutionIssue[] = [];
  const addIssue = (issue: DevolutionIssue) => {
    if (
      !issues.some((candidate) => candidate.id === issue.id && candidate.message === issue.message)
    )
      issues.push(issue);
  };
  for (const share of input.shares) {
    if (!assets.has(share.assetId))
      addIssue({
        id: "DEVOLUTION_ASSET_MISSING",
        message: "Un bene della devoluzione non appartiene più alla pratica.",
        blocking: true,
      });
  }
  for (const asset of assets.values()) {
    if (asset.kind === "donation") continue;
    const valueField = officialAssetValueField(asset);
    const officialValue = valueField
      ? getCanonicalField(declaration.declaration, valueField.canonicalId, asset.id)?.value
      : null;
    if (officialValue === null || officialValue === undefined || String(officialValue) === "")
      addIssue({
        id: "DEVOLUTION_OFFICIAL_ASSET_VALUE_MISSING",
        message: `Verifica il valore fiscale di “${asset.displayName}” nel Quadro ${asset.quadro} prima della ripartizione.`,
        blocking: true,
      });
    if (!input.shares.some((share) => share.assetId === asset.id))
      addIssue({
        id: "DEVOLUTION_ASSET_UNASSIGNED",
        message: `Manca la ripartizione di “${asset.displayName}”.`,
        blocking: true,
      });
  }
  const normalizedShares = input.shares
    .filter((share) => assets.has(share.assetId))
    .map((share) => {
      const asset = assets.get(share.assetId)!;
      const rightField = assetCatalogField(asset, "CodiceDiritto_Rip");
      const reliefField = assetCatalogField(asset, "Agevolazioni");
      const rightCode = rightField ? share.rightCode.trim().toUpperCase() : "";
      const reliefCode = share.reliefCode?.trim().toUpperCase() ?? "";
      if (rightField && !listTechnicalEnumerationValues(rightField.canonicalId).includes(rightCode))
        addIssue({
          id: "DEVOLUTION_RIGHT_CODE_INVALID",
          message: `Il codice del diritto indicato per “${asset.displayName}” non è ammesso dalla fonte ufficiale.`,
          blocking: true,
        });
      if (
        reliefCode &&
        (!reliefField ||
          !listTechnicalEnumerationValues(reliefField.canonicalId).includes(reliefCode))
      )
        addIssue({
          id: "DEVOLUTION_RELIEF_CODE_INVALID",
          message: `L’agevolazione indicata per “${asset.displayName}” non è ammessa dalla fonte ufficiale.`,
          blocking: true,
        });
      const reductionYears = share.reductionYears ?? 0;
      const previousSuccessionValueCents = share.previousSuccessionValueCents ?? 0n;
      if (reductionYears > 0 !== previousSuccessionValueCents > 0n)
        addIssue({
          id: "DEVOLUTION_REDUCTION_INCOMPLETE",
          message:
            "Per applicare la riduzione entro cinque anni servono sia il periodo sia il valore della successione precedente.",
          blocking: true,
        });
      return {
        ...share,
        rightCode,
        valueCents: 0n,
        reliefCode,
        reductionYears,
        previousSuccessionValueCents,
        foreignTaxCents: share.foreignTaxCents ?? 0n,
      };
    });
  for (const asset of assets.values()) {
    if (asset.kind === "donation") continue;
    const assetShares = normalizedShares.filter((share) => share.assetId === asset.id);
    if (assetShares.length === 0) continue;
    const previousField = officialAssetPreviousSuccessionField(asset);
    const officialValue = previousField
      ? getCanonicalField(declaration.declaration, previousField.canonicalId, asset.id)?.value
      : null;
    const officialText =
      officialValue === null || officialValue === undefined ? "" : String(officialValue);
    const officialPreviousCents = wholeEurosToCents(officialText);
    const hasConfiguredReduction = assetShares.some(
      (share) => share.reductionYears > 0 || share.previousSuccessionValueCents > 0n,
    );
    const hasOfficialPreviousValue = officialPreviousCents !== null && officialPreviousCents > 0n;
    if (!hasConfiguredReduction && !hasOfficialPreviousValue) continue;
    if (!previousField || officialText === "")
      addIssue({
        id: "DEVOLUTION_OFFICIAL_PREVIOUS_SUCCESSION_VALUE_MISSING",
        message: `Completa il valore da precedenti successioni per “${asset.displayName}” nel Quadro ufficiale.`,
        blocking: true,
      });
    const reductionPeriods = new Set(assetShares.map((share) => share.reductionYears));
    if (reductionPeriods.size !== 1 || reductionPeriods.has(0))
      addIssue({
        id: "DEVOLUTION_REDUCTION_PERIOD_INCONSISTENT",
        message: `Indica lo stesso periodo di riduzione per tutte le quote di “${asset.displayName}”.`,
        blocking: true,
      });
    if (
      officialPreviousCents !== null &&
      assetShares.some((share) => share.previousSuccessionValueCents !== officialPreviousCents)
    )
      addIssue({
        id: "DEVOLUTION_PREVIOUS_SUCCESSION_VALUE_DIVERGENCE",
        message: `Ogni quota di “${asset.displayName}” deve usare il valore da precedenti successioni indicato nel Quadro ufficiale.`,
        blocking: true,
      });
  }
  for (const beneficiaryId of beneficiaries) {
    const beneficiaryEntries = entries.filter((entry) => entry.subjectId === beneficiaryId);
    if (hasAmbiguousTaxPositions(declaration.declaration, beneficiaryEntries))
      addIssue({
        id: "DEVOLUTION_BENEFICIARY_POSITION_AMBIGUOUS",
        message:
          "Il beneficiario compare in più posizioni del Quadro EA: scegli prima quale posizione deve governare il calcolo.",
        blocking: true,
      });
  }
  for (const issue of validateDevolutionScenario(beneficiaries, normalizedShares)) addIssue(issue);
  const shares = normalizedShares.map((share, index, all) => {
    const asset = assets.get(share.assetId)!;
    const grouped = all
      .map((candidate, candidateIndex) => ({ ...candidate, index: candidateIndex }))
      .filter((candidate) => candidate.assetId === share.assetId);
    const allocations = allocateConservedCents(BigInt(asset.valueCents), grouped);
    return { ...share, valueCents: allocations?.get(index) ?? 0n };
  });
  const id = randomUUID();
  const now = new Date().toISOString();
  database.transaction(() => {
    database
      .prepare(
        `INSERT INTO devolution_scenarios(
           id, practice_id, declaration_id, ruleset_version, input_json, result_json,
           issues_json, status, confirmed_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      )
      .run(
        id,
        input.practiceId,
        input.declarationId,
        SUCCESSION_TAX_RULESET_VERSION,
        serializeBigInts(input.shares),
        serializeBigInts(shares),
        JSON.stringify(issues),
        issues.length > 0 ? "blocked" : "draft",
        now,
        now,
      );
    recordAuditEvent(
      database,
      input.practiceId,
      input.declarationId,
      "devolution.created",
      issues.length > 0
        ? "Salvata una proposta di devoluzione da correggere."
        : "Salvata una proposta di devoluzione da confermare.",
      { scenarioId: id, issueCount: issues.length },
    );
  })();
  return listDevolutionScenarios(database, input.practiceId, input.declarationId).find(
    (scenario) => scenario.id === id,
  )!;
}

export function confirmDevolutionScenario(
  database: Database.Database,
  input: {
    practiceId: string;
    declarationId: string;
    scenarioId: string;
    expectedRevision: number;
  },
): number {
  const declaration = getDeclaration(database, input.declarationId, input.practiceId);
  if (!declaration) throw new Error("DECLARATION_NOT_FOUND");
  const scenario = listDevolutionScenarios(database, input.practiceId, input.declarationId).find(
    (candidate) => candidate.id === input.scenarioId,
  );
  if (!scenario || scenario.status !== "draft" || scenario.issues.length > 0)
    throw new Error("DEVOLUTION_NOT_CONFIRMABLE");
  const now = new Date().toISOString();
  const nextDeclaration: DeclarationSnapshot = {
    ...declaration.declaration,
    confirmedDevolutionScenarioId: scenario.id,
    latestCalculationRunId: null,
    decisions: [
      ...declaration.declaration.decisions,
      {
        id: randomUUID(),
        kind: "devolution-confirmed",
        summary: "Confermata professionalmente la ripartizione dei beni e delle passività.",
        sourceRefs: ["SRC-05", "SRC-10"],
        createdAt: now,
      },
    ],
  };
  return database.transaction(() => {
    database
      .prepare(
        `UPDATE devolution_scenarios SET status = 'superseded', updated_at = ?
         WHERE practice_id = ? AND declaration_id = ? AND status = 'confirmed'`,
      )
      .run(now, input.practiceId, input.declarationId);
    database
      .prepare(
        `UPDATE devolution_scenarios
         SET status = 'confirmed', confirmed_at = ?, updated_at = ?
         WHERE id = ? AND practice_id = ? AND declaration_id = ?`,
      )
      .run(now, now, scenario.id, input.practiceId, input.declarationId);
    database
      .prepare(
        `UPDATE calculation_runs SET status = 'superseded', updated_at = ?
         WHERE practice_id = ? AND declaration_id = ? AND status <> 'superseded'`,
      )
      .run(now, input.practiceId, input.declarationId);
    const revision = saveDeclaration(
      database,
      input.declarationId,
      input.expectedRevision,
      nextDeclaration,
    );
    recordAuditEvent(
      database,
      input.practiceId,
      input.declarationId,
      "devolution.confirmed",
      "Confermata la devoluzione della dichiarazione.",
      { scenarioId: scenario.id, revision },
    );
    return revision;
  })();
}
