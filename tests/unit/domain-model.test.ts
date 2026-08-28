import { describe, expect, it } from "vitest";
import { calculateBeneficiaryTax, calculateSuccessionTax } from "../../src/domain/calculation.ts";
import { deriveOfficialFieldValue } from "../../src/domain/derived-fields.ts";
import {
  canonicalFieldKey,
  createEmptyDeclaration,
  parseDeclaration,
  setCanonicalField,
} from "../../src/domain/declaration.ts";
import { validateDevolutionScenario } from "../../src/domain/devolution.ts";
import { getCatalogStatus, listQuadroFields } from "../../src/domain/official-catalog/catalog.ts";
import { validateDeclaration, validateFieldValue } from "../../src/domain/validation.ts";

describe("modello canonico della dichiarazione", () => {
  it("migra un valore precedente senza dichiararlo confermato", () => {
    const declaration = parseDeclaration({ schemaVersion: 1, fields: { legacy: "dato" } });
    expect(declaration.schemaVersion).toBe(4);
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

  it("interpreta i pattern ministeriali con il trattino protetto", () => {
    const fieldId =
      "xsd:/Fornitura/Dichiarazione/QuadroEC/Modulo/Fabbricati/Luogo/Italia/CodiceComune";
    expect(validateFieldValue(fieldId, "H501")).toEqual([]);
    expect(validateFieldValue(fieldId, "h501").map(({ id }) => id)).toContain(
      "XSD_PATTERN_MISMATCH",
    );
  });

  it("blocca la chiusura finché la copertura semantica non è dimostrata", () => {
    const status = getCatalogStatus();
    expect(status.technicalFields).toBe(761);
    expect(status.visibleFieldsMapped).toBe(759);
    expect(status.systemManagedFields).toBe(2);
    expect(status.status).toBe("blocked");
    expect(status.releaseEligible).toBe(false);
    expect(status.blockers.length).toBeGreaterThan(0);
    expect(status.blockers.some((blocker) => blocker.includes("prescrizioni ministeriali"))).toBe(
      true,
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
});
