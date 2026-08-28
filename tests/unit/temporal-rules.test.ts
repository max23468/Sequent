import { describe, expect, test } from "vitest";
import {
  annualFiscalValuesFor,
  applicableLegalFramework,
  buildSuccessionPaymentPlan,
  calculateLifeAnnuityCents,
  calculateHistoricalLifeAnnuityCents,
  calculateLifeUsufructCents,
  calculatePerpetualAnnuityCents,
  historicalValuationInterestBasisPoints,
  ordinaryDeclarationDeadline,
  successionTaxPaymentDeadline,
  usufructCoefficientForAge,
} from "../../src/domain/temporal-rules.ts";

describe("regole fiscali per periodo", () => {
  test("seleziona la disciplina dalla data di apertura senza retroattività", () => {
    expect(applicableLegalFramework("2024-12-31")).toMatchObject({
      id: "pre-2025",
      assessmentMode: "office-assessment",
    });
    expect(applicableLegalFramework("2025-01-01")).toMatchObject({
      id: "reform-2025",
      assessmentMode: "self-assessment",
    });
    expect(applicableLegalFramework("2026-08-27")).toMatchObject({
      id: "current-2026",
      assessmentMode: "self-assessment",
    });
    expect(() => applicableLegalFramework("2027-01-01")).toThrow(
      "PERIODO_NORMATIVO_NON_QUALIFICATO",
    );
    expect(() => applicableLegalFramework("2006-10-02")).toThrow(
      "PERIODO_NORMATIVO_NON_QUALIFICATO",
    );
  });
  test("seleziona interessi e coefficienti ufficiali distinti per 2025 e 2026", () => {
    expect(annualFiscalValuesFor("2025-06-30")).toMatchObject({
      legalInterestBasisPoints: 200,
      valuationInterestFloorBasisPoints: 250,
      perpetualAnnuityMultiplier: 40,
    });
    expect(annualFiscalValuesFor("2026-06-30")).toMatchObject({
      legalInterestBasisPoints: 160,
      valuationInterestFloorBasisPoints: 250,
      perpetualAnnuityMultiplier: 40,
    });
    expect(() => annualFiscalValuesFor("2024-12-31")).toThrow("PERIODO_FISCALE_NON_QUALIFICATO");
  });

  test("applica integralmente la tabella per usufrutto e rendite vitalizie", () => {
    expect(usufructCoefficientForAge(20)).toBe(38);
    expect(usufructCoefficientForAge(21)).toBe(36);
    expect(usufructCoefficientForAge(99)).toBe(4);
    expect(calculateLifeUsufructCents(10_000_000n, 50, "2025-01-01")).toBe(7_500_000n);
    expect(calculateLifeAnnuityCents(100_000n, 70, "2026-01-01")).toBe(1_600_000n);
    expect(calculatePerpetualAnnuityCents(100_000n, "2026-01-01")).toBe(4_000_000n);
  });

  test("il caso storico non usa un interesse inferiore al 2,5 per cento", () => {
    expect(historicalValuationInterestBasisPoints(20)).toBe(250);
    expect(historicalValuationInterestBasisPoints(250)).toBe(250);
    expect(historicalValuationInterestBasisPoints(300)).toBe(300);
    expect(calculateHistoricalLifeAnnuityCents(100_000n, 70, 10)).toBe(1_600_000n);
    expect(() => calculateHistoricalLifeAnnuityCents(100_000n, 70, 300)).toThrow(
      "COEFFICIENTE_STORICO_NON_QUALIFICATO",
    );
  });

  test("calcola i termini ordinari e valida la rateazione", () => {
    expect(ordinaryDeclarationDeadline("2025-10-22")).toBe("2026-10-22");
    expect(successionTaxPaymentDeadline("2025-10-22")).toBe("2027-01-20");
    expect(
      buildSuccessionPaymentPlan({
        totalCents: 3_000_000n,
        openingDate: "2025-10-22",
        installments: 12,
        initialPaymentCents: 600_000n,
      }),
    ).toMatchObject({
      initialPaymentCents: 600_000n,
      remainingCents: 2_400_000n,
      installments: 12,
      paymentDeadline: "2027-01-20",
      taxCode: "1539",
      interestTaxCode: "1635",
    });
    expect(() =>
      buildSuccessionPaymentPlan({
        totalCents: 90_000n,
        openingDate: "2025-01-01",
        installments: 2,
        initialPaymentCents: 18_000n,
      }),
    ).toThrow("RATEAZIONE_NON_AMMESSA");
    expect(() =>
      buildSuccessionPaymentPlan({
        totalCents: 2_000_000n,
        openingDate: "2025-10-22",
        installments: 12,
        initialPaymentCents: 400_000n,
      }),
    ).toThrow("NUMERO_RATE_NON_AMMESSO");
    expect(() =>
      buildSuccessionPaymentPlan({
        totalCents: 110_000n,
        openingDate: "2025-10-22",
        installments: 2,
        initialPaymentCents: 22_000n,
      }),
    ).toThrow("RATEAZIONE_NON_AMMESSA");
    expect(() =>
      buildSuccessionPaymentPlan({
        totalCents: 2_100_000n,
        openingDate: "2025-10-22",
        installments: 12,
        initialPaymentCents: 420_000n,
      }),
    ).toThrow("NUMERO_RATE_NON_AMMESSO");
    expect(
      buildSuccessionPaymentPlan({
        totalCents: 300_000n,
        openingDate: "2025-10-22",
        installments: 1,
        initialPaymentCents: 60_000n,
      }),
    ).toMatchObject({
      initialPaymentCents: 60_000n,
      remainingCents: 240_000n,
      installments: 1,
      interestTaxCode: "1635",
    });
    expect(() =>
      buildSuccessionPaymentPlan({
        totalCents: 300_000n,
        openingDate: "2025-10-22",
        installments: 1,
      }),
    ).toThrow("ACCONTO_OBBLIGATORIO");
    expect(() =>
      buildSuccessionPaymentPlan({
        totalCents: 3_000_000n,
        openingDate: "2025-10-22",
        advanceTrustPayment: true,
        presenterCode: "1",
        hasTrustBeneficiary: true,
        paymentTiming: 1,
      }),
    ).toThrow("PAGAMENTO_ANTICIPATO_TRUST_NON_AMMESSO");
    expect(
      buildSuccessionPaymentPlan({
        totalCents: 3_000_000n,
        openingDate: "2025-10-22",
        advanceTrustPayment: true,
        presenterCode: "9",
        hasTrustBeneficiary: true,
        paymentTiming: 1,
      }).advanceTrustPayment,
    ).toBe(true);
    expect(
      buildSuccessionPaymentPlan({
        totalCents: 3_000_000n,
        openingDate: "2025-10-22",
        presenterCode: "9",
        hasTrustBeneficiary: true,
      }),
    ).toMatchObject({ advanceTrustPayment: false, interestTaxCode: null });
    expect(() =>
      buildSuccessionPaymentPlan({
        totalCents: 3_000_000n,
        openingDate: "2025-10-22",
        presenterCode: "9",
        hasTrustBeneficiary: true,
        paymentTiming: 1,
      }),
    ).toThrow("TEMPISTICA_TRUST_NON_AMMESSA");
    expect(() =>
      buildSuccessionPaymentPlan({
        totalCents: 3_000_000n,
        openingDate: "2025-10-22",
        presenterCode: "9",
        hasTrustBeneficiary: false,
        advanceTrustPayment: true,
        paymentTiming: 1,
      }),
    ).toThrow("PAGAMENTO_ANTICIPATO_TRUST_NON_AMMESSO");
  });
});
