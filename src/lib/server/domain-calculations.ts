import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  SUCCESSION_TAX_RULESET_VERSION,
  type BeneficiaryTaxResult,
  type DeclarationTaxSummary,
  type SuccessionAllocation,
} from "../../domain/calculation-types.ts";
import { calculateDeclarationTaxSummary } from "../../domain/declaration-tax.ts";
import { calculateSuccessionTax } from "../../domain/succession-tax.ts";
import { addSnapshotAutomaticOfficialFieldValues } from "../../domain/automatic-official-fields.ts";
import { calculateOfficialJurisdictionCounts } from "../../domain/municipality-conservatory.ts";
import {
  buildSuccessionPaymentPlan,
  type SuccessionPaymentPlan,
} from "../../domain/temporal-rules.ts";
import { getCanonicalField, type DeclarationSnapshot } from "../../domain/declaration.ts";
import { getCatalogStatus } from "../../domain/official-catalog/catalog.ts";
import type { ValidationIssue } from "../../domain/validation.ts";
import { getDeclaration, saveDeclaration } from "./practices.ts";
import { listSharedAssets } from "./domain-assets.ts";
import { listDevolutionScenarios } from "./domain-devolution.ts";
import { listDeclarationSubjectEntries } from "./domain-subjects.ts";
import {
  EF_PATH,
  SUCCESSION_OPENING_DATE_FIELD_ID,
  allocateConservedCents,
  assetCatalogField,
  hasAmbiguousTaxPositions,
  officialAssetForeignTaxField,
  successionOpeningDateDivergenceIssue,
  technicalWholeEuroCents,
  wholeEurosToCents,
  type CalculationRun,
  type DeclarationSubjectEntry,
} from "./domain-model.ts";
import { localTodayIso, technicalFieldValue } from "./domain-values.ts";
import { recordAuditEvent, serializeBigInts } from "./domain-write-support.ts";

function parseCalculationResult(value: string): {
  beneficiaries: BeneficiaryTaxResult[];
  totalTaxCents: bigint;
  declarationTaxes: DeclarationTaxSummary;
  paymentPlan: SuccessionPaymentPlan | null;
} {
  const parsed = JSON.parse(value) as {
    beneficiaries: Array<Record<string, unknown>>;
    totalTaxCents: string;
    declarationTaxes: Record<string, unknown>;
    paymentPlan: Record<string, unknown> | null;
  };
  const moneyKeys = [
    "qe",
    "qdn",
    "qp",
    "an",
    "fr",
    "qn",
    "pr",
    "qti",
    "isl",
    "reductions",
    "foreignTaxCredit",
    "isn",
  ];
  const reviveBigInts = <T>(input: unknown): T => {
    if (Array.isArray(input)) return input.map((item) => reviveBigInts(item)) as T;
    if (input && typeof input === "object")
      return Object.fromEntries(
        Object.entries(input).map(([key, item]) => [
          key,
          key.endsWith("Cents") && typeof item === "string" ? BigInt(item) : reviveBigInts(item),
        ]),
      ) as T;
    return input as T;
  };
  return {
    beneficiaries: parsed.beneficiaries.map((beneficiary) => {
      const converted = { ...beneficiary };
      for (const key of moneyKeys) converted[key] = BigInt(String(converted[key] ?? 0));
      return converted as unknown as BeneficiaryTaxResult;
    }),
    totalTaxCents: BigInt(parsed.totalTaxCents),
    declarationTaxes: reviveBigInts<DeclarationTaxSummary>(parsed.declarationTaxes),
    paymentPlan: parsed.paymentPlan
      ? reviveBigInts<SuccessionPaymentPlan>(parsed.paymentPlan)
      : null,
  };
}

export function listCalculationRuns(
  database: Database.Database,
  practiceId: string,
  declarationId: string,
): CalculationRun[] {
  const rows = database
    .prepare(
      `SELECT id, result_json, issues_json, status, updated_at
       FROM calculation_runs
       WHERE practice_id = ? AND declaration_id = ?
       ORDER BY updated_at DESC`,
    )
    .all(practiceId, declarationId) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    status: String(row.status) as CalculationRun["status"],
    ...parseCalculationResult(String(row.result_json)),
    issues: JSON.parse(String(row.issues_json)) as ValidationIssue[],
    updatedAt: String(row.updated_at),
  }));
}

export function getAutomaticOfficialFieldValues(
  database: Database.Database,
  practiceId: string,
  declarationId: string,
): { values: Record<string, string>; updatedAt: string; calculationId: string } | null {
  const declaration = getDeclaration(database, declarationId, practiceId);
  if (!declaration?.declaration.latestCalculationRunId) return null;
  const calculation = listCalculationRuns(database, practiceId, declarationId).find(
    (candidate) =>
      candidate.id === declaration.declaration.latestCalculationRunId &&
      candidate.status === "confirmed",
  );
  if (!calculation) return null;
  return {
    values: calculation.declarationTaxes.officialFieldValues,
    updatedAt: calculation.updatedAt,
    calculationId: calculation.id,
  };
}

export function runSuccessionCalculation(
  database: Database.Database,
  input: { practiceId: string; declarationId: string },
): CalculationRun {
  const declaration = getDeclaration(database, input.declarationId, input.practiceId);
  if (!declaration) throw new Error("DECLARATION_NOT_FOUND");
  const scenario = listDevolutionScenarios(database, input.practiceId, input.declarationId).find(
    (candidate) => candidate.id === declaration.declaration.confirmedDevolutionScenarioId,
  );
  if (!scenario || scenario.status !== "confirmed") throw new Error("DEVOLUTION_REQUIRED");
  const assets = new Map(
    listSharedAssets(database, input.practiceId, input.declarationId).map((asset) => [
      asset.id,
      asset,
    ]),
  );
  const entries = listDeclarationSubjectEntries(database, input.practiceId, input.declarationId);
  const entriesBySubject = new Map<string, DeclarationSubjectEntry[]>();
  for (const entry of entries) {
    const group = entriesBySubject.get(entry.subjectId) ?? [];
    group.push(entry);
    entriesBySubject.set(entry.subjectId, group);
  }
  const beneficiaryIds = [...new Set(scenario.shares.map((share) => share.beneficiaryId))];
  const issues: ValidationIssue[] = [];
  const openingDateIssue = successionOpeningDateDivergenceIssue(declaration.declaration);
  if (openingDateIssue) issues.push(openingDateIssue);
  const catalogStatus = getCatalogStatus();
  if (catalogStatus.status !== "qualified")
    issues.push({
      id: "CALCULATION_RULES_INCOMPLETE",
      level: "blocking",
      fieldId: null,
      message:
        "Il calcolo resta provvisorio finché tutte le regole fiscali applicabili non sono state verificate.",
      sourceId: "SRC-10",
      sourcePointer: "Catalogo delle regole di calcolo e relativi limiti di copertura",
    });
  if (!declaration.declaration.successionOpenedAt)
    issues.push({
      id: "CALCULATION_OPENING_DATE_MISSING",
      level: "blocking",
      fieldId: "frontespizio.defunto.data-decesso",
      message: "Indica la data del decesso prima di confermare il calcolo.",
      sourceId: "SRC-03",
      sourcePointer: "Frontespizio — data del decesso",
    });
  else if (declaration.declaration.successionOpenedAt > localTodayIso())
    issues.push({
      id: "CALCULATION_OPENING_DATE_FUTURE",
      level: "blocking",
      fieldId: SUCCESSION_OPENING_DATE_FIELD_ID,
      message: "La data del decesso non può essere successiva alla data odierna.",
      sourceId: "SRC-03",
      sourcePointer: "Frontespizio — data del decesso",
    });
  else if (declaration.declaration.successionOpenedAt < "2025-01-01")
    issues.push({
      id: "CALCULATION_PERIOD_NOT_QUALIFIED",
      level: "blocking",
      fieldId: "frontespizio.defunto.data-decesso",
      message:
        "Il calcolo per successioni aperte prima del 2025 richiede ancora la regola fiscale del periodo corretto.",
      sourceId: "SRC-10",
      sourcePointer: "Regole fiscali applicabili dalla versione 2025",
    });
  for (const asset of assets.values()) {
    const officialField = officialAssetForeignTaxField(asset);
    const officialValue = officialField
      ? getCanonicalField(declaration.declaration, officialField.canonicalId, asset.id)?.value
      : null;
    const officialForeignTaxCents = wholeEurosToCents(String(officialValue ?? ""));
    const allocatedForeignTaxCents = scenario.shares
      .filter((share) => share.assetId === asset.id)
      .reduce((total, share) => total + share.foreignTaxCents, 0n);
    if (officialForeignTaxCents === null || allocatedForeignTaxCents !== officialForeignTaxCents)
      issues.push({
        id: "CALCULATION_FOREIGN_TAX_DIVERGENCE",
        level: "blocking",
        fieldId: officialField?.canonicalId ?? null,
        entityId: asset.id,
        message:
          "L’imposta estera ripartita tra i beneficiari deve coincidere con quella indicata nel Quadro del bene.",
        sourceId: officialField?.sourceIds[0] ?? "SRC-10",
        sourcePointer: officialField?.sourcePointer ?? "Imposta pagata all’estero",
      });
  }
  const beneficiaries = beneficiaryIds.map((beneficiaryId) => {
    const beneficiaryEntries = entriesBySubject.get(beneficiaryId) ?? [];
    const ambiguous = hasAmbiguousTaxPositions(declaration.declaration, beneficiaryEntries);
    const entry = ambiguous ? undefined : beneficiaryEntries[0];
    if (ambiguous)
      issues.push({
        id: "CALCULATION_BENEFICIARY_POSITION_AMBIGUOUS",
        level: "blocking",
        fieldId: "quadro-ea.soggetto.tipo",
        entityId: beneficiaryId,
        message:
          "Il beneficiario compare in più posizioni del Quadro EA e il calcolo non può scegliere automaticamente quale usare.",
        sourceId: "SRC-09",
        sourcePointer: "Quadro EA — posizioni ripetute",
      });
    const relationshipCode = entry
      ? String(
          getCanonicalField(declaration.declaration, "quadro-ea.soggetto.grado-parentela", entry.id)
            ?.value ?? "",
        )
      : "";
    const subjectType = entry
      ? String(
          getCanonicalField(declaration.declaration, "quadro-ea.soggetto.tipo", entry.id)?.value ??
            "",
        )
      : "";
    const disabled = entry
      ? String(
          getCanonicalField(declaration.declaration, "quadro-ea.soggetto.disabilita", entry.id)
            ?.value ?? "0",
        ) === "1"
      : false;
    if (!entry || !relationshipCode || !subjectType)
      issues.push({
        id: "CALCULATION_BENEFICIARY_DATA_MISSING",
        level: "blocking",
        fieldId: "quadro-ea.soggetto.grado-parentela",
        message: "Completa tipo e grado di parentela di ogni beneficiario prima del calcolo.",
        sourceId: "SRC-10",
        sourcePointer: "pagine 3-5 e appendice",
      });
    return { id: beneficiaryId, relationshipCode, subjectType, disabled };
  });
  const currentShareValues = new Map<number, bigint>();
  for (const asset of assets.values()) {
    const assetShares = scenario.shares.flatMap((share, index) =>
      share.assetId === asset.id
        ? [{ index, numerator: share.numerator, denominator: share.denominator }]
        : [],
    );
    if (assetShares.length === 0) continue;
    const allocated = allocateConservedCents(BigInt(asset.valueCents), assetShares);
    if (!allocated) {
      issues.push({
        id: "CALCULATION_OFFICIAL_VALUE_ALLOCATION_INVALID",
        level: "blocking",
        fieldId: null,
        entityId: asset.id,
        message:
          "Le quote del bene non consentono di ripartire correttamente il valore fiscale indicato nel Quadro.",
        sourceId: "SRC-10",
        sourcePointer: "Valore fiscale e devoluzione del bene",
      });
      continue;
    }
    for (const [index, value] of allocated) currentShareValues.set(index, value);
  }
  const allocations: SuccessionAllocation[] = scenario.shares.map((share, index) => {
    const asset = assets.get(share.assetId ?? "");
    const beneficiary = beneficiaries.find((candidate) => candidate.id === share.beneficiaryId);
    const municipalityField = asset ? assetCatalogField(asset, "CodiceComuneAmministrativo") : null;
    const provinceField = asset ? assetCatalogField(asset, "Provincia") : null;
    const habitationRightField = asset ? assetCatalogField(asset, "DirittoAbitazione") : null;
    const landTypeField = asset ? assetCatalogField(asset, "TipologiaTerreno") : null;
    const businessAssetField = asset ? assetCatalogField(asset, "BeneAziendale") : null;
    const exemptValueField = asset ? assetCatalogField(asset, "ValoreEsente") : null;
    const canonicalAssetValue = (field: ReturnType<typeof assetCatalogField>) =>
      asset && field
        ? String(
            getCanonicalField(declaration.declaration, field.canonicalId, asset.id)?.value ?? "",
          )
        : undefined;
    return {
      assetId: share.assetId ?? "",
      beneficiaryId: share.beneficiaryId,
      treatment: asset?.treatment ?? "estate",
      valueCents: currentShareValues.get(index) ?? 0n,
      assetValueCents: BigInt(asset?.valueCents ?? 0),
      assetExemptValueCents: wholeEurosToCents(canonicalAssetValue(exemptValueField) ?? "") ?? 0n,
      businessAsset: canonicalAssetValue(businessAssetField) === "1",
      reliefCode: share.reliefCode,
      reductionYears:
        share.reductionYears === 0 ? undefined : (share.reductionYears as 1 | 2 | 3 | 4 | 5),
      previousSuccessionValueCents: share.previousSuccessionValueCents,
      foreignTaxCents: share.foreignTaxCents,
      assetKind: asset?.kind,
      municipalityCode: canonicalAssetValue(municipalityField),
      provinceCode: canonicalAssetValue(provinceField),
      habitationRightCode: canonicalAssetValue(habitationRightField),
      landTypeCode: canonicalAssetValue(landTypeField),
      relationshipCode: beneficiary?.relationshipCode,
      subjectType: beneficiary?.subjectType,
      rightCode: share.rightCode,
    };
  });
  const result = calculateSuccessionTax(beneficiaries, allocations);
  const mortgageJurisdictionText = technicalFieldValue(
    declaration.declaration,
    `${EF_PATH}/SezioneIII_TassaIpotecaria/Circoscrizioni_Numero`,
  );
  const stampDutyJurisdictionText = technicalFieldValue(
    declaration.declaration,
    `${EF_PATH}/SezioneIV_ImpostaBollo/Circoscrizioni_Numero`,
  );
  const parseDeclaredJurisdictionCount = (value: string): number | undefined =>
    value === "" ? undefined : /^\d+$/u.test(value) ? Number(value) : Number.NaN;
  const declaredMortgageJurisdictionCount =
    parseDeclaredJurisdictionCount(mortgageJurisdictionText);
  const declaredStampDutyJurisdictionCount =
    parseDeclaredJurisdictionCount(stampDutyJurisdictionText);
  const centsAt = (path: string) =>
    technicalWholeEuroCents(declaration.declaration, `${EF_PATH}/${path}`) ?? 0n;
  const paymentTimingText = technicalFieldValue(
    declaration.declaration,
    `${EF_PATH}/SezioneVBis_ImpostaSuccessione/ImpostaCalcolata/TempisticaPagamento`,
  );
  const paymentTiming = paymentTimingText === "2" ? 2 : 1;
  const installmentText = technicalFieldValue(
    declaration.declaration,
    `${EF_PATH}/SezioneVBis_ImpostaSuccessione/ImpostaCalcolata/PagamentoRateale`,
  );
  const installmentCount = /^\d+$/u.test(installmentText) ? Number(installmentText) : undefined;
  const initialPaymentText = technicalFieldValue(
    declaration.declaration,
    `${EF_PATH}/SezioneVBis_ImpostaSuccessione/ImpostaCalcolata/Acconto`,
  );
  const initialPaymentCents = wholeEurosToCents(initialPaymentText);
  const openingDateForCalculation =
    declaration.declaration.successionOpenedAt &&
    declaration.declaration.successionOpenedAt >= "2006-10-03" &&
    declaration.declaration.successionOpenedAt <= "2026-12-31"
      ? declaration.declaration.successionOpenedAt
      : "2026-08-27";
  const presenterCode = technicalFieldValue(
    declaration.declaration,
    "/Fornitura/Dichiarazione/Frontespizio/Presentatore/CodiceCarica",
  );
  const substituteType =
    declaration.declaration.declarationKind === "first"
      ? undefined
      : (declaration.declaration.declarationKind.slice(-1) as "1" | "2" | "3");
  const jurisdictionCounts = calculateOfficialJurisdictionCounts(
    allocations,
    declaration.declaration.declarationKind,
    {
      mortgage: declaredMortgageJurisdictionCount,
      stampDuty: declaredStampDutyJurisdictionCount,
    },
  );
  for (const municipalityCode of jurisdictionCounts.unresolvedMunicipalityCodes)
    issues.push({
      id: "CALCULATION_CONSERVATORY_NOT_FOUND",
      level: "blocking",
      fieldId: null,
      message: municipalityCode
        ? `Il Comune amministrativo ${municipalityCode} non è presente nella mappa ufficiale delle conservatorie.`
        : "Indica il Comune amministrativo per ogni immobile soggetto a pubblicità immobiliare.",
      sourceId: "SRC-39",
      sourcePointer:
        "it/finanze/entrate/sco/resources/comuni_conservatorie.res e regole SUC13 TassaIpotecaria/ImpostaDiBollo",
    });
  if (jurisdictionCounts.mode === "professional-input") {
    const jurisdictionFields = [
      {
        kind: "MORTGAGE",
        status: jurisdictionCounts.declaredCountStatus.mortgage,
        fieldId: `xsd:${EF_PATH}/SezioneIII_TassaIpotecaria/Circoscrizioni_Numero`,
        row: "EF15",
        taxLabel: "tassa ipotecaria",
        maximum: jurisdictionCounts.mortgageMaximum,
      },
      {
        kind: "STAMP_DUTY",
        status: jurisdictionCounts.declaredCountStatus.stampDuty,
        fieldId: `xsd:${EF_PATH}/SezioneIV_ImpostaBollo/Circoscrizioni_Numero`,
        row: "EF16",
        taxLabel: "imposta di bollo",
        maximum: jurisdictionCounts.stampDutyMaximum,
      },
    ] as const;
    for (const field of jurisdictionFields) {
      if (field.status === "valid") continue;
      const message =
        field.status === "above-maximum"
          ? `Il numero di circoscrizioni per la ${field.taxLabel} supera il massimo ufficiale calcolato (${field.maximum}).`
          : field.status === "invalid"
            ? `Il numero di circoscrizioni per la ${field.taxLabel} deve essere un intero non negativo.`
            : `Indica il numero di circoscrizioni interessate da nuove trascrizioni per la ${field.taxLabel}.`;
      issues.push({
        id: `CALCULATION_${field.kind}_JURISDICTIONS_${field.status.toUpperCase().replace("-", "_")}`,
        level: "blocking",
        fieldId: field.fieldId,
        message,
        sourceId: "SRC-39",
        sourcePointer: `Quadro EF, rigo ${field.row}; controllo SUC13`,
      });
    }
  }
  const hasTestament =
    technicalFieldValue(
      declaration.declaration,
      "/Fornitura/Dichiarazione/Frontespizio/TipoDichiarazione/Devoluzione/DevoluzionePerTestamento",
    ) === "1" ||
    technicalFieldValue(
      declaration.declaration,
      "/Fornitura/Dichiarazione/QuadroEG/Testamento/TestamentoNum",
    ) !== "";
  const allBeneficiariesDisabled =
    entries.length > 0 &&
    entries.every(
      (entry) =>
        String(
          getCanonicalField(declaration.declaration, "quadro-ea.soggetto.disabilita", entry.id)
            ?.value ?? "0",
        ) === "1",
    );
  const hasTrustBeneficiary = entries.some((entry) => {
    const finalBeneficiary = String(
      getCanonicalField(
        declaration.declaration,
        "quadro-ea.soggetto.trust.beneficiario-finale",
        entry.id,
      )?.value ?? "",
    ).trim();
    const relationshipCode = String(
      getCanonicalField(declaration.declaration, "quadro-ea.soggetto.grado-parentela", entry.id)
        ?.value ?? "",
    );
    return finalBeneficiary !== "" || relationshipCode === "35";
  });
  const advanceTrustPayment =
    technicalFieldValue(
      declaration.declaration,
      `${EF_PATH}/SezioneVBis_ImpostaSuccessione/PagamentoAnticipatoTrust`,
    ) === "1";
  let declarationTaxes = calculateDeclarationTaxSummary(allocations, result.totalTaxCents, {
    openingDate: openingDateForCalculation,
    declaredMortgageJurisdictionCount,
    declaredStampDutyJurisdictionCount,
    automaticLandRegistry:
      technicalFieldValue(
        declaration.declaration,
        "/Fornitura/Dichiarazione/Frontespizio/CasiParticolari/CasiParticolari",
      ) !== "1",
    copyRequested:
      technicalFieldValue(
        declaration.declaration,
        "/Fornitura/Dichiarazione/Frontespizio/CasiParticolari/CopiaConforme",
      ) === "1",
    hasTestament,
    presenterCode,
    allBeneficiariesDisabled,
    substituteType,
    paymentTiming,
    mortgageAlreadyPaidCents: centsAt("SezioneI_ImpostaIpotecaria/ImpostaIpotecariaVersata"),
    mortgageCreditCents: centsAt("SezioneI_ImpostaIpotecaria/CreditoImposta"),
    cadastralAlreadyPaidCents: centsAt("SezioneII_ImpostaCatastale/ImpostaCatastaleVersata"),
    cadastralCreditCents: centsAt("SezioneII_ImpostaCatastale/CreditoImposta"),
    successionAlreadyPaidCents: centsAt(
      "SezioneVBis_ImpostaSuccessione/ImpostaCalcolata/ImpostaVersata",
    ),
    successionCreditCents: centsAt(
      "SezioneVBis_ImpostaSuccessione/ImpostaCalcolata/CreditoImposta",
    ),
    penaltiesCents: [
      "ImpostaIpotecaria",
      "ImpostaCatastale",
      "TassaIpotecaria",
      "ImpostaBollo",
      "ImpostaSuccessione",
    ].map((section) => centsAt(`SezioneVI_SanzioniInteressi/${section}/${section}_Sanzioni`)),
    interestCents: [
      "ImpostaIpotecaria",
      "ImpostaCatastale",
      "TassaIpotecaria",
      "ImpostaBollo",
      "ImpostaSuccessione",
    ].map((section) => centsAt(`SezioneVI_SanzioniInteressi/${section}/${section}_Interessi`)),
  });
  const trustAdvanceAllowed = presenterCode === "9" && hasTrustBeneficiary;
  if (advanceTrustPayment && !trustAdvanceAllowed)
    issues.push({
      id: "CALCULATION_ADVANCE_TRUST_PAYMENT_NOT_ALLOWED",
      level: "blocking",
      fieldId: `xsd:${EF_PATH}/SezioneVBis_ImpostaSuccessione/PagamentoAnticipatoTrust`,
      message:
        "Il pagamento anticipato del trust richiede il presentatore previsto e un beneficiario del trust nel Quadro EA.",
      sourceId: "SRC-08",
      sourcePointer: "Quadro EF, rigo EF18-ter",
    });
  if (
    paymentTimingText !== "" &&
    (declarationTaxes.successionTax.payableCents === 0n ||
      (presenterCode === "9" && !advanceTrustPayment))
  )
    issues.push({
      id: "CALCULATION_PAYMENT_TIMING_NOT_ALLOWED",
      level: "blocking",
      fieldId: `xsd:${EF_PATH}/SezioneVBis_ImpostaSuccessione/ImpostaCalcolata/TempisticaPagamento`,
      message: "La tempistica di pagamento non è prevista per questa dichiarazione.",
      sourceId: "SRC-08",
      sourcePointer: "Quadro EF, rigo EF18-ter",
    });
  if (initialPaymentText !== "" && installmentText === "")
    issues.push({
      id: "CALCULATION_INITIAL_PAYMENT_WITHOUT_INSTALLMENTS",
      level: "blocking",
      fieldId: `xsd:${EF_PATH}/SezioneVBis_ImpostaSuccessione/ImpostaCalcolata/Acconto`,
      message: "L’acconto può essere indicato soltanto insieme al pagamento rateale.",
      sourceId: "SRC-08",
      sourcePointer: "Quadro EF, rigo EF18-ter",
    });
  let paymentPlan: SuccessionPaymentPlan | null = null;
  if (declarationTaxes.successionTax.payableCents > 0n) {
    try {
      paymentPlan = buildSuccessionPaymentPlan({
        totalCents: declarationTaxes.successionTax.payableCents,
        openingDate: declaration.declaration.successionOpenedAt ?? "2025-01-01",
        installments: installmentCount,
        initialPaymentCents:
          installmentText === "" ? undefined : (initialPaymentCents ?? undefined),
        presenterCode,
        hasTrustBeneficiary,
        advanceTrustPayment,
        paymentTiming: paymentTimingText === "" ? undefined : paymentTiming,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "PIANO_NON_VALIDO";
      const messages: Record<string, string> = {
        NUMERO_RATE_NON_VALIDO: "Il numero di rate indicato non è ammesso.",
        RATEAZIONE_NON_AMMESSA:
          "Il residuo dopo l’acconto è inferiore a 1.000 euro e non può essere rateizzato.",
        NUMERO_RATE_NON_AMMESSO:
          "Con un residuo non superiore a 20.000 euro sono ammesse al massimo otto rate.",
        ACCONTO_NON_VALIDO:
          "L’acconto deve essere compreso tra il 20% dell’imposta dovuta e l’intero importo.",
        ACCONTO_OBBLIGATORIO: "Indica l’acconto quando scegli il pagamento rateale.",
        PAGAMENTO_ANTICIPATO_TRUST_NON_AMMESSO:
          "Il pagamento anticipato non è ammesso per il trust indicato.",
        TEMPISTICA_TRUST_NON_AMMESSA:
          "La tempistica di pagamento non è prevista senza pagamento anticipato del trust.",
        RATEAZIONE_TRUST_NON_AMMESSA:
          "Il pagamento rateale non è previsto senza pagamento anticipato del trust.",
        TEMPISTICA_TRUST_OBBLIGATORIA:
          "Indica la tempistica quando scegli il pagamento anticipato del trust.",
        TEMPISTICA_OBBLIGATORIA:
          "Indica nel Quadro EF quando sarà versata l’imposta di successione.",
      };
      const fieldId = code.startsWith("TEMPISTICA_")
        ? `xsd:${EF_PATH}/SezioneVBis_ImpostaSuccessione/ImpostaCalcolata/TempisticaPagamento`
        : code === "PAGAMENTO_ANTICIPATO_TRUST_NON_AMMESSO"
          ? `xsd:${EF_PATH}/SezioneVBis_ImpostaSuccessione/PagamentoAnticipatoTrust`
          : `xsd:${EF_PATH}/SezioneVBis_ImpostaSuccessione/ImpostaCalcolata/PagamentoRateale`;
      issues.push({
        id: `CALCULATION_PAYMENT_PLAN_${code}`,
        level: "blocking",
        fieldId,
        message: messages[code] ?? "Il piano di pagamento indicato non è valido.",
        sourceId: "SRC-13",
        sourcePointer: "Pagamento dell’imposta di successione e rateazione",
      });
    }
  }
  declarationTaxes = calculateDeclarationTaxSummary(allocations, result.totalTaxCents, {
    openingDate: openingDateForCalculation,
    declaredMortgageJurisdictionCount,
    declaredStampDutyJurisdictionCount,
    automaticLandRegistry:
      technicalFieldValue(
        declaration.declaration,
        "/Fornitura/Dichiarazione/Frontespizio/CasiParticolari/CasiParticolari",
      ) !== "1",
    copyRequested:
      technicalFieldValue(
        declaration.declaration,
        "/Fornitura/Dichiarazione/Frontespizio/CasiParticolari/CopiaConforme",
      ) === "1",
    hasTestament,
    presenterCode,
    allBeneficiariesDisabled,
    substituteType,
    paymentTiming,
    initialSuccessionPaymentCents: paymentPlan?.initialPaymentCents,
    mortgageAlreadyPaidCents: declarationTaxes.mortgageTax.alreadyPaidCents,
    mortgageCreditCents: declarationTaxes.mortgageTax.creditCents,
    cadastralAlreadyPaidCents: declarationTaxes.cadastralTax.alreadyPaidCents,
    cadastralCreditCents: declarationTaxes.cadastralTax.creditCents,
    successionAlreadyPaidCents: declarationTaxes.successionTax.alreadyPaidCents,
    successionCreditCents: declarationTaxes.successionTax.creditCents,
    penaltiesCents: [declarationTaxes.penaltiesCents],
    interestCents: [declarationTaxes.interestCents],
  });
  declarationTaxes = {
    ...declarationTaxes,
    officialFieldValues: addSnapshotAutomaticOfficialFieldValues(
      declaration.declaration,
      declarationTaxes.officialFieldValues,
    ),
  };
  const compareDeclaredEuro = (
    path: string,
    expectedCents: bigint,
    label: string,
    sourceId: string,
  ) => {
    const entered = technicalFieldValue(declaration.declaration, path);
    if (entered === "") return;
    const enteredCents = wholeEurosToCents(entered);
    if (enteredCents === expectedCents) return;
    issues.push({
      id: `CALCULATION_DECLARED_DIVERGENCE:${path}`,
      level: "blocking",
      fieldId: `xsd:${path}`,
      message: `${label}: il valore indicato non coincide con il calcolo della pratica.`,
      sourceId,
      sourcePointer: path,
    });
  };
  compareDeclaredEuro(
    "/Fornitura/Dichiarazione/QuadroEE/TotaleValoreImmobili",
    declarationTaxes.estate.propertyCents,
    "Totale immobili",
    "SRC-08",
  );
  compareDeclaredEuro(
    "/Fornitura/Dichiarazione/QuadroEE/TotaleAttivo",
    declarationTaxes.estate.totalAssetsCents,
    "Totale attivo",
    "SRC-08",
  );
  compareDeclaredEuro(
    "/Fornitura/Dichiarazione/QuadroEE/TotalePassivo",
    declarationTaxes.estate.totalLiabilitiesCents,
    "Totale passivo",
    "SRC-08",
  );
  compareDeclaredEuro(
    `${EF_PATH}/SezioneI_ImpostaIpotecaria/ImpostaIpotecariaDaVersare`,
    declarationTaxes.mortgageTax.payableCents,
    "Imposta ipotecaria da versare",
    "SRC-08",
  );
  compareDeclaredEuro(
    `${EF_PATH}/SezioneII_ImpostaCatastale/ImpostaCatastaleDaVersare`,
    declarationTaxes.cadastralTax.payableCents,
    "Imposta catastale da versare",
    "SRC-08",
  );
  compareDeclaredEuro(
    `${EF_PATH}/SezioneVBis_ImpostaSuccessione/ImpostaCalcolata/ImpostaDaVersare`,
    declarationTaxes.successionTax.payableCents,
    "Imposta di successione da versare",
    "SRC-08",
  );
  compareDeclaredEuro(
    `${EF_PATH}/TotaleDaVersare`,
    declarationTaxes.totalAtSubmissionCents,
    "Totale da versare",
    "SRC-08",
  );
  const inputJson = serializeBigInts({
    beneficiaries,
    allocations,
    scenarioId: scenario.id,
    calculationContext: {
      successionOpenedAt: declaration.declaration.successionOpenedAt,
      evaluationDate: localTodayIso(),
      catalogStatus,
      issues,
      declarationTaxes,
      paymentPlan,
    },
  });
  const inputHash = createHash("sha256").update(inputJson).digest("hex");
  const existing = database
    .prepare(
      `SELECT id FROM calculation_runs
       WHERE declaration_id = ? AND ruleset_version = ? AND input_hash = ?`,
    )
    .get(input.declarationId, SUCCESSION_TAX_RULESET_VERSION, inputHash) as
    | { id: string }
    | undefined;
  if (existing)
    return listCalculationRuns(database, input.practiceId, input.declarationId).find(
      (run) => run.id === existing.id,
    )!;
  const id = randomUUID();
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO calculation_runs(
         id, practice_id, declaration_id, ruleset_version, input_hash, input_json,
         result_json, issues_json, status, confirmed_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .run(
      id,
      input.practiceId,
      input.declarationId,
      SUCCESSION_TAX_RULESET_VERSION,
      inputHash,
      inputJson,
      serializeBigInts({ ...result, declarationTaxes, paymentPlan }),
      JSON.stringify(issues),
      issues.length > 0 ? "blocked" : "draft",
      now,
      now,
    );
  recordAuditEvent(
    database,
    input.practiceId,
    input.declarationId,
    "calculation.created",
    issues.length > 0
      ? "Eseguito un calcolo con dati da completare."
      : "Eseguito il calcolo dell’imposta da confermare.",
    { calculationId: id, inputHash },
  );
  return listCalculationRuns(database, input.practiceId, input.declarationId).find(
    (run) => run.id === id,
  )!;
}

export function confirmCalculationRun(
  database: Database.Database,
  input: {
    practiceId: string;
    declarationId: string;
    calculationId: string;
    expectedRevision: number;
  },
): number {
  const declaration = getDeclaration(database, input.declarationId, input.practiceId);
  if (!declaration) throw new Error("DECLARATION_NOT_FOUND");
  const calculation = listCalculationRuns(database, input.practiceId, input.declarationId).find(
    (candidate) => candidate.id === input.calculationId,
  );
  if (
    !calculation ||
    calculation.status !== "draft" ||
    calculation.issues.length > 0 ||
    getCatalogStatus().status !== "qualified"
  )
    throw new Error("CALCULATION_NOT_CONFIRMABLE");
  const now = new Date().toISOString();
  const nextDeclaration: DeclarationSnapshot = {
    ...declaration.declaration,
    latestCalculationRunId: calculation.id,
    decisions: [
      ...declaration.declaration.decisions,
      {
        id: randomUUID(),
        kind: "calculation-confirmed",
        summary: "Confermato professionalmente il calcolo della dichiarazione.",
        sourceRefs: ["SRC-10"],
        createdAt: now,
      },
    ],
  };
  return database.transaction(() => {
    database
      .prepare(
        `UPDATE calculation_runs SET status = 'superseded', updated_at = ?
         WHERE practice_id = ? AND declaration_id = ? AND status = 'confirmed'`,
      )
      .run(now, input.practiceId, input.declarationId);
    database
      .prepare(
        `UPDATE calculation_runs
         SET status = 'confirmed', confirmed_at = ?, updated_at = ?
         WHERE id = ? AND practice_id = ? AND declaration_id = ?`,
      )
      .run(now, now, calculation.id, input.practiceId, input.declarationId);
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
      "calculation.confirmed",
      "Confermato il calcolo della dichiarazione.",
      { calculationId: calculation.id, revision },
    );
    return revision;
  })();
}
