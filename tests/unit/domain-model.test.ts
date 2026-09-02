import { describe, expect, it } from "vitest";
import {
  calculateBondAccruedInterestCents,
  calculateBuildingFiscalValueCents,
  calculateCompanyNetValueCents,
  calculateDeductibleRecentMaintenanceDebtCents,
  calculateLandFiscalValueCents,
  calculateRealRightValueCents,
  calculateSplitRealRightValues,
} from "../../src/domain/asset-valuation.ts";
import type { SuccessionAllocation } from "../../src/domain/calculation-types.ts";
import { calculateDeclarationTaxSummary } from "../../src/domain/declaration-tax.ts";
import {
  calculateBeneficiaryTax,
  calculateSuccessionTax,
} from "../../src/domain/succession-tax.ts";
import { deriveOfficialFieldValue } from "../../src/domain/derived-fields.ts";
import { normalizeItalianTypography } from "../../src/domain/italian-typography.ts";
import {
  canonicalFieldKey,
  createEmptyDeclaration,
  parseDeclaration,
  setCanonicalField,
} from "../../src/domain/declaration.ts";
import { validateDevolutionScenario } from "../../src/domain/devolution.ts";
import {
  QUADRI,
  getCatalogStatus,
  listOfficialChoiceOptions,
  listQuadroFields,
  listQuadroSummaries,
  listTechnicalEnumerationValues,
} from "../../src/domain/official-catalog/catalog.ts";
import { validateDeclaration, validateFieldValue } from "../../src/domain/validation.ts";

describe("modello canonico della dichiarazione", () => {
  it("rifiuta versioni precedenti, future e snapshot correnti incompleti", () => {
    expect(() => parseDeclaration({ schemaVersion: 1, fields: {} })).toThrow(
      "DECLARATION_SCHEMA_UNSUPPORTED",
    );
    expect(() => parseDeclaration({ schemaVersion: 999, fields: {} })).toThrow(
      "DECLARATION_SCHEMA_UNSUPPORTED",
    );
    expect(() => parseDeclaration({ schemaVersion: 7, fields: {} })).toThrow(
      "DECLARATION_SCHEMA_INVALID",
    );
    expect(parseDeclaration(createEmptyDeclaration())).toEqual(createEmptyDeclaration());
  });

  it("rifiuta date impossibili e chiavi canoniche incoerenti", () => {
    expect(() =>
      parseDeclaration({ ...createEmptyDeclaration(), successionOpenedAt: "2026-02-30" }),
    ).toThrow("DECLARATION_SCHEMA_INVALID");
    const declaration = setCanonicalField(
      createEmptyDeclaration(),
      "quadro-ea.soggetto.codice-fiscale",
      "RSSMRA80A01H501U",
      "confirmed",
      [],
      "soggetto-sintetico",
    );
    const [field] = Object.values(declaration.fields);
    expect(() =>
      parseDeclaration({ ...declaration, fields: { "chiave-non-canonica": field } }),
    ).toThrow("DECLARATION_SCHEMA_INVALID");
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

  it("non richiede una conferma generica per i campi compilati manualmente", () => {
    const fieldId = "quadro-ea.soggetto.codice-fiscale";
    const entityId = "soggetto-sintetico";
    const declaration = setCanonicalField(
      createEmptyDeclaration(),
      fieldId,
      "RSSMRA80A01H501U",
      "manually_corrected",
      [],
      entityId,
    );
    expect(validateDeclaration(declaration)).toEqual([]);
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

  it("presenta etichette e indicazioni ufficiali con gli accenti italiani", () => {
    const frontFields = listQuadroFields("Frontespizio");
    expect(frontFields.some((field) => field.label === "Località di residenza estera")).toBe(true);
    expect(normalizeItalianTypography("FORLI'")).toBe("FORLÌ");

    const visibleText = [
      ...QUADRI.flatMap((quadro) =>
        listQuadroFields(quadro).flatMap((field) => [
          field.label,
          field.section ?? "",
          ...field.options.map((option) => option.label),
        ]),
      ),
      ...QUADRI.flatMap((quadro) =>
        listQuadroFields(quadro).flatMap((field) =>
          field.instructions.map((instruction) => instruction.instruction),
        ),
      ),
    ].join("\n");
    expect(visibleText).not.toMatch(
      /\b(?:attivita|disabilita|dovra|gia|identita|localita|nazionalita|passivita|pubblicita|puo|quantita|societa|unita|volonta)'?\b/iu,
    );
  });

  it("non degrada in testo libero nessuna enumerazione XSD, anche se annidata", () => {
    for (const quadro of QUADRI) {
      for (const field of listQuadroFields(quadro).filter(
        (candidate) => candidate.visibleFieldId !== null,
      )) {
        const values = listTechnicalEnumerationValues(field.canonicalId);
        if (values.length === 0) continue;
        expect(
          field.options.map((option) => option.value),
          field.canonicalId,
        ).toEqual(values);
        expect(["checkbox", "select", "combobox"], field.canonicalId).toContain(field.control);
      }
    }
    expect(
      listQuadroFields("EC").find((field) => field.name === "CategoriaCatastale"),
    ).toMatchObject({
      control: "select",
      options: expect.arrayContaining([
        expect.objectContaining({ value: "A1", label: expect.stringContaining("Abitazioni") }),
      ]),
    });
    expect(listQuadroFields("EC").find((field) => field.name === "Provincia")).toMatchObject({
      control: "combobox",
      options: expect.arrayContaining([
        expect.objectContaining({ value: "MI", label: expect.stringContaining("Milano") }),
      ]),
    });
  });

  it("collega tutti i riferimenti territoriali ai cataloghi ufficiali vincolati", () => {
    const municipalityCode = listQuadroFields("EC").find((field) => field.name === "CodiceComune");
    expect(municipalityCode).toMatchObject({
      control: "combobox",
      choiceSource: "municipality-code",
    });
    expect(
      listOfficialChoiceOptions(municipalityCode!.canonicalId, {
        provinceCode: "MI",
        query: "Milano",
      }),
    ).toContainEqual(expect.objectContaining({ value: "F205", provinceCode: "MI" }));
    expect(validateFieldValue(municipalityCode!.canonicalId, "F205")).toEqual([]);
    expect(validateFieldValue(municipalityCode!.canonicalId, "ZZZZ").map(({ id }) => id)).toContain(
      "OFFICIAL_CHOICE_MISMATCH",
    );
    const foreignState = listQuadroFields("EC").find((field) => field.name === "StatoEstero");
    expect(foreignState).toMatchObject({ control: "combobox", choiceSource: "foreign-state-name" });
    expect(
      listOfficialChoiceOptions(foreignState!.canonicalId, { query: "Francia" }),
    ).toContainEqual(expect.objectContaining({ value: "FRANCIA" }));
    const tavolareCode = listQuadroFields("EM").find(
      (field) => field.name === "CodiceComuneAmministrativo",
    );
    expect(tavolareCode).toMatchObject({
      control: "combobox",
      choiceSource: "tavolare-municipality-code",
    });
    expect(
      listOfficialChoiceOptions(tavolareCode!.canonicalId, { query: "Cortina" }),
    ).toContainEqual(
      expect.objectContaining({
        value: "A266",
        label: expect.stringContaining("CORTINA D'AMPEZZO"),
      }),
    );
    expect(validateFieldValue(tavolareCode!.canonicalId, "F205").map(({ id }) => id)).toContain(
      "OFFICIAL_CHOICE_MISMATCH",
    );
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
          valueCents: 15_000_000n,
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
    expect(summary.officialFieldValues).toMatchObject({
      "xsd:/Fornitura/Dichiarazione/QuadroEE/TotaleValoreImmobili": "300000",
      "xsd:/Fornitura/Dichiarazione/QuadroEE/TotaleAttivo": "320000",
      "xsd:/Fornitura/Dichiarazione/QuadroEE/TotaleValoreAsseEreditarioNetto": "310000",
      "xsd:/Fornitura/Dichiarazione/QuadroEF/SezioneI_ImpostaIpotecaria/PrimaCasa/PrimaCasa_Numero":
        "1",
      "xsd:/Fornitura/Dichiarazione/QuadroEF/SezioneI_ImpostaIpotecaria/PrimaCasa/AgevolazionePX_Valore":
        "100000",
      "xsd:/Fornitura/Dichiarazione/QuadroEF/SezioneI_ImpostaIpotecaria/ImpostaIpotecariaDovuta":
        "4200",
      "xsd:/Fornitura/Dichiarazione/QuadroEF/SezioneII_ImpostaCatastale/ImpostaCatastaleDovuta":
        "2200",
      "xsd:/Fornitura/Dichiarazione/QuadroEF/SezioneIII_TassaIpotecaria/Circoscrizioni_Imposta":
        "240",
      "xsd:/Fornitura/Dichiarazione/QuadroEF/SezioneIII_TassaIpotecaria/Circoscrizioni_Numero": "2",
      "xsd:/Fornitura/Dichiarazione/QuadroEF/SezioneIV_ImpostaBollo/ImpostaBollo_CopiaConforme":
        "32",
      "xsd:/Fornitura/Dichiarazione/QuadroEF/SezioneIV_ImpostaBollo/Circoscrizioni_Numero": "2",
      "xsd:/Fornitura/Dichiarazione/QuadroEF/SezioneIV_ImpostaBollo/Circoscrizioni_Imposta": "202",
      "xsd:/Fornitura/Dichiarazione/QuadroEF/SezioneV_TributiSpeciali/CopiaConforme/CopiaConforme_Importo":
        "16",
      "xsd:/Fornitura/Dichiarazione/QuadroEF/TotaleDaVersare": "7858",
      "xsd:/Fornitura/Dichiarazione/QuadroEF/SezioneVBis_ImpostaSuccessione/ImpostaCalcolata/ImpostaDaVersare":
        "5000",
    });
  });

  it("compone il Quadro EE con immobili aziendali e valore esente dei titoli", () => {
    const summary = calculateDeclarationTaxSummary(
      [
        {
          assetId: "immobile-aziendale",
          beneficiaryId: "beneficiario",
          treatment: "estate",
          valueCents: 10_000_000n,
          assetValueCents: 10_000_000n,
          assetKind: "building",
          businessAsset: true,
        },
        {
          assetId: "titolo-con-valore-esente",
          beneficiaryId: "beneficiario",
          treatment: "estate",
          valueCents: 1_000_000n,
          assetValueCents: 1_000_000n,
          assetExemptValueCents: 500_000n,
          assetKind: "securities",
        },
      ],
      0n,
      {
        openingDate: "2025-10-22",
        automaticLandRegistry: true,
        copyRequested: false,
        paymentTiming: 1,
      },
    );

    expect(summary.estate).toMatchObject({
      propertyCents: 0n,
      securitiesCents: 1_500_000n,
      totalAssetsCents: 1_500_000n,
    });
  });

  it.each([
    {
      name: "beneficiario con grado di parentela 36",
      allocation: { relationshipCode: "36" },
      options: {},
    },
    {
      name: "testamento presentato dal rappresentante di tutti i beneficiari disabili",
      allocation: { relationshipCode: "01" },
      options: { hasTestament: true, presenterCode: "9", allBeneficiariesDisabled: true },
    },
    {
      name: "testamento presentato per un trust esente",
      allocation: { relationshipCode: "37", subjectType: "5" },
      options: { hasTestament: true, presenterCode: "9" },
    },
  ])("azzera il bollo della copia per $name", ({ allocation, options }) => {
    const summary = calculateDeclarationTaxSummary(
      [
        {
          assetId: "immobile-esente-bollo",
          beneficiaryId: "beneficiario-esente",
          treatment: "estate",
          valueCents: 1_000_000n,
          assetValueCents: 1_000_000n,
          assetKind: "building",
          ...allocation,
        },
      ],
      0n,
      {
        openingDate: "2025-10-22",
        automaticLandRegistry: true,
        copyRequested: true,
        paymentTiming: 1,
        ...options,
      },
    );

    expect(summary.stampDutyCents).toBe(0n);
    expect(summary.specialTaxesCents).toBe(1_600n);
  });

  it("conta una sola imposta fissa per abitazione, pertinenze e immobili contigui", () => {
    const property = (
      assetId: string,
      beneficiaryId: string,
      reliefCode: string,
      additions: Partial<SuccessionAllocation> = {},
    ): SuccessionAllocation => ({
      assetId,
      beneficiaryId,
      treatment: "estate",
      valueCents: 1_000_000n,
      assetValueCents: 1_000_000n,
      assetKind: "building",
      provinceCode: "RM",
      relationshipCode: "01",
      reliefCode,
      ...additions,
    });
    const summary = calculateDeclarationTaxSummary(
      [
        property("abitazione-principale", "beneficiario-a", "P"),
        property("abitazione-principale", "beneficiario-altro", ""),
        property("pertinenza", "beneficiario-a", "X"),
        property("contiguo", "beneficiario-a", "Z"),
        property("pertinenza-senza-casa-1", "beneficiario-b", "Y"),
        property("pertinenza-senza-casa-2", "beneficiario-b", "Y"),
        property("diritto-abitazione", "beneficiario-c", "", { habitationRightCode: "1" }),
        property("immobile-estero", "beneficiario-d", "P", {
          provinceCode: "EE",
          habitationRightCode: "1",
        }),
        property("soggetto-escluso", "beneficiario-e", "P", { relationshipCode: "36" }),
      ],
      0n,
      {
        openingDate: "2025-10-22",
        automaticLandRegistry: true,
        copyRequested: false,
        paymentTiming: 1,
      },
    );

    expect(summary.mortgageTax).toMatchObject({ taxableCents: 0n, dueCents: 60_000n });
    expect(summary.cadastralTax).toMatchObject({ taxableCents: 0n, dueCents: 60_000n });
    expect(
      summary.officialFieldValues[
        "xsd:/Fornitura/Dichiarazione/QuadroEF/SezioneI_ImpostaIpotecaria/PrimaCasa/PrimaCasa_Numero"
      ],
    ).toBe("3");
    expect(
      summary.officialFieldValues[
        "xsd:/Fornitura/Dichiarazione/QuadroEF/SezioneI_ImpostaIpotecaria/PrimaCasa/AgevolazionePX_Valore"
      ],
    ).toBe("90000");
  });

  it("mantiene proporzionale la quota dello stesso immobile non coperta dall’agevolazione G", () => {
    const allocation = (beneficiaryId: string, reliefCode: string): SuccessionAllocation => ({
      assetId: "immobile-misto-g",
      beneficiaryId,
      treatment: "estate",
      valueCents: 10_000_000n,
      assetValueCents: 20_000_000n,
      assetKind: "building",
      reliefCode,
    });
    const summary = calculateDeclarationTaxSummary(
      [allocation("beneficiario-agevolato", "G"), allocation("beneficiario-ordinario", "")],
      0n,
      {
        openingDate: "2025-10-22",
        automaticLandRegistry: true,
        copyRequested: false,
        paymentTiming: 1,
      },
    );

    expect(summary.mortgageTax).toMatchObject({
      taxableCents: 10_000_000n,
      dueCents: 200_000n,
    });
    expect(summary.cadastralTax).toMatchObject({
      taxableCents: 10_000_000n,
      dueCents: 100_000n,
    });
    expect(
      summary.officialFieldValues[
        "xsd:/Fornitura/Dichiarazione/QuadroEF/SezioneI_ImpostaIpotecaria/AgevolazioneG/AgevolazioneG_Valore"
      ],
    ).toBe("100000");
  });

  it("estende l’agevolazione M a tutte le quote dello stesso immobile", () => {
    const allocation = (beneficiaryId: string, reliefCode: string): SuccessionAllocation => ({
      assetId: "immobile-misto-m",
      beneficiaryId,
      treatment: "estate",
      valueCents: 10_000_000n,
      assetValueCents: 20_000_000n,
      assetKind: "building",
      reliefCode,
    });
    const summary = calculateDeclarationTaxSummary(
      [allocation("beneficiario-agevolato", "M"), allocation("beneficiario-ordinario", "")],
      0n,
      {
        openingDate: "2025-10-22",
        automaticLandRegistry: true,
        copyRequested: false,
        paymentTiming: 1,
      },
    );

    expect(summary.mortgageTax).toMatchObject({ taxableCents: 0n, dueCents: 20_000n });
    expect(summary.cadastralTax).toMatchObject({ taxableCents: 0n, dueCents: 0n });
    expect(
      summary.officialFieldValues[
        "xsd:/Fornitura/Dichiarazione/QuadroEF/SezioneI_ImpostaIpotecaria/AgevolazioneM/AgevolazioneM_Valore"
      ],
    ).toBe("200000");
  });

  it("applica il regime agevolato del trust soltanto dal 2017", () => {
    const allocation: SuccessionAllocation = {
      assetId: "immobile-trust",
      beneficiaryId: "trust",
      treatment: "estate",
      valueCents: 1_000_000n,
      assetValueCents: 1_000_000n,
      assetKind: "building",
      subjectType: "5",
    };
    const options = {
      automaticLandRegistry: true,
      copyRequested: false,
      paymentTiming: 1 as const,
    };

    const before2017 = calculateDeclarationTaxSummary([allocation], 0n, {
      ...options,
      openingDate: "2016-12-31",
    });
    const from2017 = calculateDeclarationTaxSummary([allocation], 0n, {
      ...options,
      openingDate: "2017-01-01",
    });

    expect(before2017.mortgageTax).toMatchObject({ taxableCents: 1_000_000n, dueCents: 20_000n });
    expect(before2017.cadastralTax).toMatchObject({ taxableCents: 1_000_000n, dueCents: 20_000n });
    expect(from2017.mortgageTax).toMatchObject({ taxableCents: 0n, dueCents: 20_000n });
    expect(from2017.cadastralTax).toMatchObject({ taxableCents: 0n, dueCents: 20_000n });
  });

  it.each(["G", "M"])("usa l’imposta fissa storica per l’agevolazione %s", (reliefCode) => {
    const summary = calculateDeclarationTaxSummary(
      [
        {
          assetId: `immobile-storico-${reliefCode}`,
          beneficiaryId: "beneficiario",
          treatment: "estate",
          valueCents: 1_000_000n,
          assetValueCents: 1_000_000n,
          assetKind: "building",
          reliefCode,
        },
      ],
      0n,
      {
        openingDate: "2013-12-31",
        automaticLandRegistry: true,
        copyRequested: false,
        paymentTiming: 1,
      },
    );

    expect(summary.mortgageTax.dueCents).toBe(16_800n);
  });

  it("usa il minimo e la prima casa storici prima del 2014", () => {
    const ordinary: SuccessionAllocation = {
      assetId: "immobile-storico-ordinario",
      beneficiaryId: "beneficiario",
      treatment: "estate",
      valueCents: 500_000n,
      assetValueCents: 500_000n,
      assetKind: "building",
    };
    const firstHome = { ...ordinary, assetId: "prima-casa-storica", reliefCode: "P" };
    const options = {
      openingDate: "2013-12-31",
      automaticLandRegistry: true,
      copyRequested: false,
      paymentTiming: 1 as const,
    };

    const ordinarySummary = calculateDeclarationTaxSummary([ordinary], 0n, options);
    const firstHomeSummary = calculateDeclarationTaxSummary([firstHome], 0n, options);

    expect(ordinarySummary.mortgageTax.dueCents).toBe(16_800n);
    expect(ordinarySummary.cadastralTax.dueCents).toBe(16_800n);
    expect(firstHomeSummary.mortgageTax.dueCents).toBe(16_800n);
    expect(firstHomeSummary.cadastralTax.dueCents).toBe(16_800n);
  });

  it("limita le imposte al valore dei soli terreni non edificabili sotto soglia", () => {
    const summary = calculateDeclarationTaxSummary(
      [
        {
          assetId: "terreno-non-edificabile",
          beneficiaryId: "beneficiario",
          treatment: "estate",
          valueCents: 30_000n,
          assetValueCents: 30_000n,
          assetKind: "land",
          landTypeCode: "3",
          reliefCode: "",
        },
      ],
      0n,
      {
        openingDate: "2025-10-22",
        automaticLandRegistry: true,
        copyRequested: false,
        paymentTiming: 1,
      },
    );

    expect(summary.mortgageTax).toMatchObject({ taxableCents: 30_000n, dueCents: 20_000n });
    expect(summary.cadastralTax).toMatchObject({ taxableCents: 30_000n, dueCents: 10_000n });
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
      automaticLandRegistry: false,
      copyRequested: false,
      paymentTiming: 2,
    });
    expect(summary.assessmentMode).toBe("office-assessment");
    expect(summary.totalAtSubmissionCents).toBe(0n);
  });

  it("arrotonda l’imposta di successione all’euro prima del Quadro EF", () => {
    const summary = calculateDeclarationTaxSummary([], 886_546n, {
      openingDate: "2025-10-22",
      automaticLandRegistry: true,
      copyRequested: false,
      paymentTiming: 2,
    });

    expect(summary.successionTax).toMatchObject({
      calculatedCents: 886_500n,
      payableCents: 886_500n,
    });
    expect(summary.totalAtSubmissionCents).toBe(886_500n);
  });

  it("riapplica il minimo alle imposte immobiliari della sostitutiva di tipo 1", () => {
    const allocation: SuccessionAllocation = {
      assetId: "immobile-sostitutiva",
      beneficiaryId: "beneficiario",
      treatment: "estate",
      valueCents: 1_000_000n,
      assetValueCents: 1_000_000n,
      assetKind: "building",
    };
    const options = {
      openingDate: "2025-10-22",
      automaticLandRegistry: true,
      copyRequested: false,
      paymentTiming: 1 as const,
      mortgageAlreadyPaidCents: 15_000n,
      cadastralAlreadyPaidCents: 15_000n,
    };

    const substitute = calculateDeclarationTaxSummary([allocation], 0n, {
      ...options,
      substituteType: "1",
    });
    const ordinary = calculateDeclarationTaxSummary([allocation], 0n, options);

    expect(substitute.mortgageTax.payableCents).toBe(20_000n);
    expect(substitute.cadastralTax.payableCents).toBe(20_000n);
    expect(ordinary.mortgageTax.payableCents).toBe(5_000n);
    expect(ordinary.cadastralTax.payableCents).toBe(5_000n);
  });

  it("non riapplica il minimo ipotecario della sostitutiva in presenza del rigo EF2", () => {
    const summary = calculateDeclarationTaxSummary(
      [
        {
          assetId: "immobile-agevolazione-g",
          beneficiaryId: "beneficiario",
          treatment: "estate",
          valueCents: 100_000_000n,
          assetValueCents: 100_000_000n,
          assetKind: "building",
          reliefCode: "G",
        },
      ],
      0n,
      {
        openingDate: "2025-10-22",
        automaticLandRegistry: true,
        copyRequested: false,
        paymentTiming: 1,
        substituteType: "1",
        mortgageAlreadyPaidCents: 15_000n,
      },
    );

    expect(summary.mortgageTax.dueCents).toBe(20_000n);
    expect(summary.mortgageTax.payableCents).toBe(5_000n);
  });
});
