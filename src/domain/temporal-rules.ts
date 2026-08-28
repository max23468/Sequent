import legalTimeline from "./official-catalog/legal-timeline.json" with { type: "json" };

export const TEMPORAL_RULESET_VERSION = "2026.08.5" as const;

export interface ApplicableLegalFramework {
  id: string;
  openingFrom: string | null;
  openingTo: string;
  assessmentMode: "office-assessment" | "self-assessment";
  sourceIds: readonly string[];
  notes: readonly string[];
}

export interface AnnualFiscalValues {
  year: 2025 | 2026;
  effectiveFrom: string;
  effectiveTo: string;
  legalInterestBasisPoints: 200 | 160;
  valuationInterestFloorBasisPoints: 250;
  perpetualAnnuityMultiplier: 40;
  sourceIds: readonly [string, string, "SRC-27"];
}

const ANNUAL_VALUES: readonly AnnualFiscalValues[] = [
  {
    year: 2025,
    effectiveFrom: "2025-01-01",
    effectiveTo: "2025-12-31",
    legalInterestBasisPoints: 200,
    valuationInterestFloorBasisPoints: 250,
    perpetualAnnuityMultiplier: 40,
    sourceIds: ["SRC-23", "SRC-24", "SRC-27"],
  },
  {
    year: 2026,
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-12-31",
    legalInterestBasisPoints: 160,
    valuationInterestFloorBasisPoints: 250,
    perpetualAnnuityMultiplier: 40,
    sourceIds: ["SRC-25", "SRC-26", "SRC-27"],
  },
] as const;

const LIFE_COEFFICIENTS = [
  { from: 0, to: 20, coefficient: 38 },
  { from: 21, to: 30, coefficient: 36 },
  { from: 31, to: 40, coefficient: 34 },
  { from: 41, to: 45, coefficient: 32 },
  { from: 46, to: 50, coefficient: 30 },
  { from: 51, to: 53, coefficient: 28 },
  { from: 54, to: 56, coefficient: 26 },
  { from: 57, to: 60, coefficient: 24 },
  { from: 61, to: 63, coefficient: 22 },
  { from: 64, to: 66, coefficient: 20 },
  { from: 67, to: 69, coefficient: 18 },
  { from: 70, to: 72, coefficient: 16 },
  { from: 73, to: 75, coefficient: 14 },
  { from: 76, to: 78, coefficient: 12 },
  { from: 79, to: 82, coefficient: 10 },
  { from: 83, to: 86, coefficient: 8 },
  { from: 87, to: 92, coefficient: 6 },
  { from: 93, to: 99, coefficient: 4 },
] as const;

function assertIsoDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new Error("DATA_NON_VALIDA");
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value)
    throw new Error("DATA_NON_VALIDA");
}

function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("DIVISORE_NON_VALIDO");
  return (numerator + denominator / 2n) / denominator;
}

export function applicableLegalFramework(openingDate: string): ApplicableLegalFramework {
  assertIsoDate(openingDate);
  const framework = legalTimeline.periods.find(
    (candidate) =>
      (candidate.openingFrom === null || openingDate >= candidate.openingFrom) &&
      openingDate <= candidate.openingTo,
  );
  if (!framework) throw new Error("PERIODO_NORMATIVO_NON_QUALIFICATO");
  return framework as ApplicableLegalFramework;
}

export function annualFiscalValuesFor(openingDate: string): AnnualFiscalValues {
  assertIsoDate(openingDate);
  const values = ANNUAL_VALUES.find(
    (candidate) => openingDate >= candidate.effectiveFrom && openingDate <= candidate.effectiveTo,
  );
  if (!values) throw new Error("PERIODO_FISCALE_NON_QUALIFICATO");
  return values;
}

export function usufructCoefficientForAge(age: number): number {
  if (!Number.isInteger(age) || age < 0 || age > 99) throw new Error("ETA_NON_VALIDA");
  return LIFE_COEFFICIENTS.find((band) => age >= band.from && age <= band.to)!.coefficient;
}

export function calculateLifeUsufructCents(
  fullOwnershipCents: bigint,
  age: number,
  openingDate: string,
): bigint {
  if (fullOwnershipCents < 0n) throw new Error("VALORE_NON_VALIDO");
  const values = annualFiscalValuesFor(openingDate);
  return roundHalfUp(
    fullOwnershipCents *
      BigInt(values.valuationInterestFloorBasisPoints) *
      BigInt(usufructCoefficientForAge(age)),
    10_000n,
  );
}

export function calculatePerpetualAnnuityCents(
  annualAmountCents: bigint,
  openingDate: string,
): bigint {
  if (annualAmountCents < 0n) throw new Error("VALORE_NON_VALIDO");
  return annualAmountCents * BigInt(annualFiscalValuesFor(openingDate).perpetualAnnuityMultiplier);
}

export function calculateLifeAnnuityCents(
  annualAmountCents: bigint,
  age: number,
  openingDate: string,
): bigint {
  if (annualAmountCents < 0n) throw new Error("VALORE_NON_VALIDO");
  annualFiscalValuesFor(openingDate);
  return annualAmountCents * BigInt(usufructCoefficientForAge(age));
}

export function calculateHistoricalLifeAnnuityCents(
  annualAmountCents: bigint,
  age: number,
  legalInterestBasisPoints: number,
): bigint {
  if (annualAmountCents < 0n) throw new Error("VALORE_NON_VALIDO");
  if (historicalValuationInterestBasisPoints(legalInterestBasisPoints) !== 250)
    throw new Error("COEFFICIENTE_STORICO_NON_QUALIFICATO");
  return annualAmountCents * BigInt(usufructCoefficientForAge(age));
}

export function historicalValuationInterestBasisPoints(legalInterestBasisPoints: number): number {
  if (!Number.isInteger(legalInterestBasisPoints) || legalInterestBasisPoints < 0)
    throw new Error("TASSO_NON_VALIDO");
  return Math.max(legalInterestBasisPoints, 250);
}

function addUtcMonths(date: Date, months: number): Date {
  const day = date.getUTCDate();
  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

function addUtcDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function ordinaryDeclarationDeadline(openingDate: string): string {
  assertIsoDate(openingDate);
  return addUtcMonths(new Date(`${openingDate}T00:00:00Z`), 12)
    .toISOString()
    .slice(0, 10);
}

export function successionTaxPaymentDeadline(openingDate: string): string {
  return addUtcDays(new Date(`${ordinaryDeclarationDeadline(openingDate)}T00:00:00Z`), 90)
    .toISOString()
    .slice(0, 10);
}

export interface SuccessionPaymentPlan {
  totalCents: bigint;
  initialPaymentCents: bigint;
  remainingCents: bigint;
  installments: number;
  paymentDeadline: string;
  taxCode: "1539";
  interestTaxCode: "1635" | null;
  advanceTrustPayment: boolean;
  sourceIds: readonly ["SRC-13", "SRC-14"];
}

export function buildSuccessionPaymentPlan(input: {
  totalCents: bigint;
  openingDate: string;
  installments?: number;
  initialPaymentCents?: bigint;
  presenterCode?: string;
  hasTrustBeneficiary?: boolean;
  advanceTrustPayment?: boolean;
}): SuccessionPaymentPlan {
  const { totalCents } = input;
  if (totalCents < 0n) throw new Error("IMPORTO_NON_VALIDO");
  const installments = input.installments ?? 1;
  if (!Number.isInteger(installments) || installments < 1 || installments > 12)
    throw new Error("NUMERO_RATE_NON_VALIDO");
  const minimumInitial = roundHalfUp(totalCents * 20n, 100n);
  const initialPaymentCents =
    input.initialPaymentCents ?? (installments > 1 ? minimumInitial : totalCents);
  if (
    initialPaymentCents < 0n ||
    initialPaymentCents > totalCents ||
    (installments > 1 && initialPaymentCents < minimumInitial)
  )
    throw new Error("ACCONTO_NON_VALIDO");
  const remainingCents = totalCents - initialPaymentCents;
  if (installments > 1 && totalCents < 100_000n) throw new Error("RATEAZIONE_NON_AMMESSA");
  if (installments > 8 && totalCents <= 2_000_000n) throw new Error("NUMERO_RATE_NON_AMMESSO");
  const advanceTrustPayment = input.advanceTrustPayment ?? false;
  if (advanceTrustPayment && (input.presenterCode !== "9" || input.hasTrustBeneficiary !== true))
    throw new Error("PAGAMENTO_ANTICIPATO_TRUST_NON_AMMESSO");
  return {
    totalCents,
    initialPaymentCents,
    remainingCents,
    installments,
    paymentDeadline: successionTaxPaymentDeadline(input.openingDate),
    taxCode: "1539",
    interestTaxCode: installments > 1 ? "1635" : null,
    advanceTrustPayment,
    sourceIds: ["SRC-13", "SRC-14"],
  };
}
