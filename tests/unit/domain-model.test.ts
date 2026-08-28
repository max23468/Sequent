import { describe, expect, it } from "vitest";
import {
  calculateBondAccruedInterestCents,
  calculateBuildingFiscalValueCents,
  calculateBeneficiaryTax,
  calculateCompanyNetValueCents,
  calculateDeductibleRecentMaintenanceDebtCents,
  calculateDeclarationTaxSummary,
  calculateLandFiscalValueCents,
  calculateRealRightValueCents,
  calculateSplitRealRightValues,
  calculateSuccessionTax,
} from "../../src/domain/calculation.ts";
import { deriveOfficialFieldValue } from "../../src/domain/derived-fields.ts";
import {
  canonicalFieldKey,
  createEmptyDeclaration,
  parseDeclaration,
  setCanonicalField,
} from "../../src/domain/declaration.ts";
import { validateDevolutionScenario } from "../../src/domain/devolution.ts";
import {
  getCatalogStatus,
  listOfficialInstructions,
  listQuadroFields,
  listQuadroSummaries,
} from "../../src/domain/official-catalog/catalog.ts";
import { validateDeclaration, validateFieldValue } from "../../src/domain/validation.ts";

describe("modello canonico della dichiarazione", () => {
  it("migra un valore precedente senza dichiararlo confermato", () => {
    const declaration = parseDeclaration({ schemaVersion: 1, fields: { legacy: "dato" } });
    expect(declaration.schemaVersion).toBe(7);
    expect(declaration.fields.legacy).toMatchObject({ value: "dato", state: "to_review" });
  });

  it("usa lo stesso identificativo nella vista per quadri e nella dichiarazione", () => {
    const field = listQuadroFields("EA").find((candidate) => candidate.label === "Codice fiscale");
    expect(field?.canonicalId).toBe("quadro-ea.soggetto.codice-fiscale");
    const updated = setCanonicalField(
      createEmptyDeclaration(),
      field!.canonicalId,
      "RSSMRA80A01H501U",
      "manually_corrected",
      [],
      "soggetto-sintetico",
    );
    expect(updated.fields[canonicalFieldKey(field!.canonicalId, "soggetto-sintetico")]?.value).toBe(
      "RSSMRA80A01H501U",
    );
  });

  it("applica il formato XSD e richiede conferma sui dati incerti", () => {
    const fieldId = "quadro-ea.soggetto.codice-fiscale";
    expect(validateFieldValue(fieldId, "RSSMRA80A01H501U")).toEqual([]);
    expect(validateFieldValue(fieldId, "NON-VALIDO")[0]?.id).toBe("XSD_PATTERN_MISMATCH");
    const declaration = setCanonicalField(
      createEmptyDeclaration(),
      fieldId,
      "RSSMRA80A01H501U",
      "to_review",
      [],
      "soggetto-sintetico",
    );
    expect(
      validateDeclaration(declaration).some((issue) =>
        issue.id.startsWith("PROFESSIONAL_CONFIRMATION_REQUIRED:"),
      ),
    ).toBe(true);
  });

  it("lega la conferma professionale al valore e alle indicazioni ministeriali correnti", () => {
    const fieldId = "quadro-ea.soggetto.codice-fiscale";
    const entityId = "soggetto-sintetico";
    const fieldKey = canonicalFieldKey(fieldId, entityId);
    const declaration = setCanonicalField(
      createEmptyDeclaration(),
      fieldId,
      "RSSMRA80A01H501U",
      "manually_corrected",
      [],
      entityId,
    );
    expect(
      validateDeclaration(declaration).some((issue) =>
        issue.id.startsWith("OFFICIAL_INSTRUCTION_CONFIRMATION_REQUIRED:"),
      ),
    ).toBe(true);
    const instructions = listOfficialInstructions(fieldId);
    expect(instructions.length).toBeGreaterThan(0);
    expect(instructions.every((instruction) => instruction.effectiveFrom === "2025-07-15")).toBe(
      true,
    );
    const confirmed = {
      ...declaration,
      officialRuleConfirmations: {
        [fieldKey]: {
          ruleIds: instructions.map((instruction) => instruction.id).sort(),
          valueJson: JSON.stringify("RSSMRA80A01H501U"),
          confirmedAt: "2026-08-28T00:00:00.000Z",
        },
      },
    };
    expect(
      validateDeclaration(confirmed).some((issue) =>
        issue.id.startsWith("OFFICIAL_INSTRUCTION_CONFIRMATION_REQUIRED:"),
      ),
    ).toBe(false);
  });

  it("interpreta i pattern ministeriali con il trattino protetto", () => {
    const fieldId =
      "xsd:/Fornitura/Dichiarazione/QuadroEC/Modulo/Fabbricati/Luogo/Italia/CodiceComune";
    expect(validateFieldValue(fieldId, "H501")).toEqual([]);
    expect(validateFieldValue(fieldId, "h501").map(({ id }) => id)).toContain(
      "XSD_PATTERN_MISMATCH",
    );
  });

  it("valida il contenuto Base64 e riconosce i gruppi ufficiali ripetibili", () => {
    const fieldId = "xsd:/Fornitura/Dichiarazione/QuadroEG/Testamento/TestamentoAll/ImageData";
    expect(validateFieldValue(fieldId, "SGVsbG8=")).toEqual([]);
    expect(validateFieldValue(fieldId, "%%%non-base64%%%").map(({ id }) => id)).toContain(
      "XSD_PRIMITIVE_TYPE_MISMATCH",
    );
    expect(listQuadroFields("EG").find((field) => field.canonicalId === fieldId)).toMatchObject({
      entityScope: "occurrence",
      occurrenceGroup: "/Fornitura/Dichiarazione/QuadroEG/Testamento/TestamentoAll",
    });
  });

  it("qualifica il catalogo soltanto con copertura completa e senza rilievi aperti", () => {
    const status = getCatalogStatus();
    expect(status.technicalFields).toBe(761);
    expect(status.visibleFieldsMapped).toBe(715);
    expect(status.systemManagedFields).toBe(46);
    expect(status.status).toBe("qualified");
    expect(status.releaseEligible).toBe(true);
    expect(status.blockers).toEqual([]);
  });

  it("nei contatori visibili esclude i dati tecnici degli allegati", () => {
    const summaries = listQuadroSummaries();
    expect(summaries.reduce((total, quadro) => total + quadro.userFieldCount, 0)).toBe(715);
    expect(summaries.find((quadro) => quadro.id === "EG")).toMatchObject({
      userFieldCount: 11,
      verifiedFieldCount: 11,
    });
  });

  it("collega i dati verificati del Frontespizio al defunto del procedimento", () => {
    const fields = listQuadroFields("Frontespizio").filter(
      (field) => field.visibleFieldId !== null,
    );
    expect(fields).toHaveLength(86);
    expect(fields.filter((field) => field.entityScope === "decedent")).toHaveLength(10);
    expect(fields.filter((field) => field.entryMode === "derived")).toHaveLength(5);
    expect(fields.find((field) => field.label === "Stato civile")?.options).toHaveLength(7);
    expect(validateFieldValue("frontespizio.defunto.codice-fiscale", "RSSMRA80A01H501U")).toEqual(
      [],
    );
  });

  it("deriva tipo di dichiarazione e conteggi senza duplicare i dati", () => {
    expect(
      deriveOfficialFieldValue("declaration-kind:first", {
        declarationKind: "first",
        quadroEaTypeCounts: { "1": 2, "2": 1 },
      }),
    ).toBe("1");
    expect(
      deriveOfficialFieldValue("declaration-kind:substitute", {
        declarationKind: "substitute-2",
        quadroEaTypeCounts: {},
      }),
    ).toBe("2");
    expect(
      deriveOfficialFieldValue("quadro-ea:type:1", {
        declarationKind: "first",
        quadroEaTypeCounts: { "1": 2 },
      }),
    ).toBe("2");
  });
});

describe("motori deterministici", () => {
  it("quadratura uno scenario di devoluzione e blocca beneficiari estranei", () => {
    const valid = validateDevolutionScenario(new Set(["a", "b"]), [
      {
        beneficiaryId: "a",
        numerator: 1n,
        denominator: 2n,
        rightCode: "sintetico",
        valueCents: 1n,
      },
      {
        beneficiaryId: "b",
        numerator: 1n,
        denominator: 2n,
        rightCode: "sintetico",
        valueCents: 1n,
      },
    ]);
    expect(valid).toEqual([]);
    const invalid = validateDevolutionScenario(new Set(["a"]), [
      {
        beneficiaryId: "c",
        numerator: 1n,
        denominator: 3n,
        rightCode: "sintetico",
        valueCents: 1n,
      },
    ]);
    expect(invalid.map((issue) => issue.id)).toEqual([
      "DEVOLUTION_BENEFICIARY_MISSING",
      "DEVOLUTION_NOT_BALANCED",
    ]);
    const malformed = validateDevolutionScenario(new Set(["a"]), [
      {
        beneficiaryId: "a",
        numerator: 1n,
        denominator: 0n,
        rightCode: "sintetico",
        valueCents: 1n,
      },
    ]);
    expect(malformed.map((issue) => issue.id)).toEqual(["DEVOLUTION_SHARE_INVALID"]);
  });

  it("rende espliciti i passaggi QE-ISN senza usare numeri in virgola mobile", () => {
    const result = calculateBeneficiaryTax({
      beneficiaryId: "beneficiario-sintetico",
      devolvedEstateCents: 15_000_000n,
      presumedAssetsCents: 0n,
      allocatedLiabilitiesCents: 0n,
      allowanceCents: 10_000_000n,
      rateBasisPoints: 400n,
      reductionsCents: 0n,
      foreignTaxCreditCents: 0n,
      presumptionApplicable: true,
    });
    expect(result).toMatchObject({
      an: 15_000_000n,
      qn: 5_000_000n,
      pr: 500_000n,
      qti: 5_500_000n,
      isl: 220_000n,
      isn: 220_000n,
    });
    expect(
      calculateBeneficiaryTax({
        beneficiaryId: "beneficiario-sintetico",
        devolvedEstateCents: 15_000_000n,
        presumedAssetsCents: 0n,
        allocatedLiabilitiesCents: 0n,
        allowanceCents: 10_000_000n,
        rateBasisPoints: 400n,
        reductionsCents: 0n,
        foreignTaxCreditCents: 0n,
        presumptionApplicable: false,
      }).pr,
    ).toBe(0n);
  });

  it("riproduce integralmente l’esempio ministeriale con due fratelli", () => {
    const beneficiaries = ["fratello-a", "fratello-b"].map((id) => ({
      id,
      relationshipCode: "10",
      subjectType: "1",
      disabled: false,
    }));
    const allocations = beneficiaries.flatMap((beneficiary) => [
      {
        assetId: `agevolato-${beneficiary.id}`,
        beneficiaryId: beneficiary.id,
        treatment: "estate" as const,
        valueCents: 12_500_000n,
        assetValueCents: 12_500_000n,
        reliefCode: "L",
      },
      {
        assetId: `altro-${beneficiary.id}`,
        beneficiaryId: beneficiary.id,
        treatment: "estate" as const,
        valueCents: 7_500_000n,
        assetValueCents: 7_500_000n,
      },
      {
        assetId: `denaro-${beneficiary.id}`,
        beneficiaryId: beneficiary.id,
        treatment: "dn" as const,
        valueCents: 250_000n,
        assetValueCents: 250_000n,
        foreignTaxCents: 50_000n,
      },
      {
        assetId: `passivita-${beneficiary.id}`,
        beneficiaryId: beneficiary.id,
        treatment: "liability" as const,
        valueCents: 50_000n,
        assetValueCents: 50_000n,
      },
    ]);
    const result = calculateSuccessionTax(beneficiaries, allocations);
    expect(result.totalTaxCents).toBe(886_546n);
    for (const beneficiary of result.beneficiaries)
      expect(beneficiary).toMatchObject({
        qe: 20_000_000n,
        qdn: 250_000n,
        qp: 50_000n,
        an: 20_200_000n,
        fr: 10_000_000n,
        qn: 10_200_000n,
        pr: 745_000n,
        qti: 10_945_000n,
        isl: 656_700n,
        reductions: 205_219n,
        foreignTaxCredit: 8_208n,
        isn: 443_273n,
      });
  });

  it("quadratura attivo, imposte immobiliari e totale del Quadro EF", () => {
    const summary = calculateDeclarationTaxSummary(
      [
        {
          assetId: "fabbricato-ordinario",
          beneficiaryId: "beneficiario",
          treatment: "estate",
          valueCents: 20_000_000n,
          assetValueCents: 20_000_000n,
          assetKind: "building",
          municipalityCode: "H501",
        },
        {
          assetId: "prima-casa",
          beneficiaryId: "beneficiario",
          treatment: "estate",
          valueCents: 10_000_000n,
          assetValueCents: 10_000_000n,
          assetKind: "building",
          municipalityCode: "F205",
          reliefCode: "P",
        },
        {
          assetId: "conto",
          beneficiaryId: "beneficiario",
          treatment: "dn",
          valueCents: 2_000_000n,
          assetValueCents: 2_000_000n,
          assetKind: "money",
        },
        {
          assetId: "debito",
          beneficiaryId: "beneficiario",
          treatment: "liability",
          valueCents: 1_000_000n,
          assetValueCents: 1_000_000n,
          assetKind: "liability",
        },
      ],
      500_000n,
      {
        openingDate: "2025-10-22",
        jurisdictionCount: 2,
        automaticLandRegistry: true,
        copyRequested: true,
        paymentTiming: 2,
        initialSuccessionPaymentCents: 100_000n,
      },
    );
    expect(summary.estate).toEqual({
      propertyCents: 30_000_000n,
      companiesCents: 0n,
      securitiesCents: 0n,
      aircraftAndVesselsCents: 0n,
      otherAssetsCents: 2_000_000n,
      totalAssetsCents: 32_000_000n,
      totalLiabilitiesCents: 1_000_000n,
      netEstateCents: 31_000_000n,
    });
    expect(summary.mortgageTax).toMatchObject({
      taxableCents: 20_000_000n,
      dueCents: 420_000n,
      payableCents: 420_000n,
    });
    expect(summary.cadastralTax).toMatchObject({
      taxableCents: 20_000_000n,
      dueCents: 220_000n,
      payableCents: 220_000n,
    });
    expect(summary).toMatchObject({
      assessmentMode: "self-assessment",
      mortgageServicesCents: 24_000n,
      stampDutyCents: 20_200n,
      specialTaxesCents: 1_600n,
      totalAtSubmissionCents: 785_800n,
    });
  });

  it("riproduce gli esempi ministeriali su nuda proprietà e diritti divisi", () => {
    expect(
      calculateRealRightValueCents({
        fullOwnershipCents: 20_000_000n,
        possession: { numerator: 1n, denominator: 2n },
        right: "bare-ownership",
        openingDate: "2025-01-01",
        age: 65,
      }),
    ).toBe(5_000_000n);
    expect(
      calculateSplitRealRightValues({
        fullOwnershipCents: 20_000_000n,
        possession: { numerator: 1n, denominator: 2n },
        openingDate: "2025-01-01",
        bareOwnershipShare: { numerator: 1n, denominator: 1n },
        usufructShares: [
          {
            beneficiaryId: "EA2",
            share: { numerator: 1n, denominator: 2n },
            age: 19,
          },
          {
            beneficiaryId: "EA3",
            share: { numerator: 1n, denominator: 2n },
            age: 25,
          },
        ],
      }),
    ).toEqual({
      bareOwnershipCents: 750_000n,
      usufructByBeneficiary: { EA2: 4_750_000n, EA3: 4_500_000n },
    });
  });

  it("calcola valori catastali, azienda e diritti di enfiteusi", () => {
    expect(
      calculateBuildingFiscalValueCents({
        cadastralIncomeCents: 100_000n,
        category: "A/2",
        firstHome: false,
        possession: { numerator: 1n, denominator: 2n },
      }),
    ).toBe(6_300_000n);
    expect(() =>
      calculateBuildingFiscalValueCents({
        cadastralIncomeCents: 100_000n,
        category: "A/10",
        firstHome: true,
        possession: { numerator: 1n, denominator: 1n },
      }),
    ).toThrow("CATEGORIA_PRIMA_CASA_NON_AMMESSA");
    expect(calculateLandFiscalValueCents(200_000n, { numerator: 1n, denominator: 2n })).toBe(
      11_250_000n,
    );
    expect(
      calculateCompanyNetValueCents({
        assetsCents: 20_000_000n,
        liabilitiesCents: 5_000_000n,
        excludedAssetsCents: 1_000_000n,
        goodwillCents: 2_000_000n,
      }),
    ).toBe(12_000_000n);
    expect(
      calculateRealRightValueCents({
        fullOwnershipCents: 10_000_000n,
        possession: { numerator: 1n, denominator: 1n },
        right: "emphyteusis",
        openingDate: "2025-01-01",
        annualCanonCents: 100_000n,
        redemptionCents: 3_000_000n,
      }),
    ).toBe(7_000_000n);
  });

  it("riproduce debito recente e ratei dei titoli degli esempi ufficiali", () => {
    expect(
      calculateDeductibleRecentMaintenanceDebtCents({
        outstandingDebtCents: 300_000n,
        beneficiaryKind: "dependent-family-member",
        fullMonths: [
          { taxYear: 2024, dependentInYear: false },
          { taxYear: 2025, dependentInYear: true },
          { taxYear: 2025, dependentInYear: true },
          { taxYear: 2025, dependentInYear: true },
        ],
      }),
    ).toBe(77_400n);
    expect(
      calculateBondAccruedInterestCents({
        capitalCents: 100_000n,
        annualRateBasisPoints: 300n,
        elapsedDays: 92n,
        couponPeriodDays: 182n,
        paymentsPerYear: 2n,
      }),
    ).toBe(758n);
    expect(
      calculateBondAccruedInterestCents({
        capitalCents: 100_000n,
        annualRateBasisPoints: 500n,
        elapsedDays: 62n,
        couponPeriodDays: 184n,
        paymentsPerYear: 2n,
      }),
    ).toBe(842n);
  });

  it("mantiene fuori dall’autoliquidazione le successioni anteriori al 2025", () => {
    const summary = calculateDeclarationTaxSummary([], 500_000n, {
      openingDate: "2024-12-31",
      jurisdictionCount: 0,
      automaticLandRegistry: false,
      copyRequested: false,
      paymentTiming: 2,
    });
    expect(summary.assessmentMode).toBe("office-assessment");
    expect(summary.totalAtSubmissionCents).toBe(0n);
  });
});
