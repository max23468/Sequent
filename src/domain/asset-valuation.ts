import { annualFiscalValuesFor, usufructCoefficientForAge } from "./temporal-rules.ts";
import { divideRoundedHalfUp, nonNegative } from "./calculation-math.ts";
import type { Fraction, RealRight } from "./calculation-types.ts";

function applyFraction(valueCents: bigint, fraction: Fraction): bigint {
  if (
    valueCents < 0n ||
    fraction.numerator < 0n ||
    fraction.denominator <= 0n ||
    fraction.numerator > fraction.denominator
  )
    throw new Error("QUOTA_NON_VALIDA");
  return divideRoundedHalfUp(valueCents * fraction.numerator, fraction.denominator);
}

export function calculateRealRightValueCents(input: {
  fullOwnershipCents: bigint;
  possession: Fraction;
  right: RealRight;
  openingDate: string;
  age?: number;
  annualCanonCents?: bigint;
  redemptionCents?: bigint;
}): bigint {
  const possessedValue = applyFraction(input.fullOwnershipCents, input.possession);
  if (input.right === "full-ownership") return possessedValue;
  if (input.right === "grantor") {
    if (input.redemptionCents === undefined || input.redemptionCents < 0n)
      throw new Error("AFFRANCAZIONE_MANCANTE");
    return input.redemptionCents;
  }
  if (input.right === "emphyteusis") {
    if (
      input.annualCanonCents === undefined ||
      input.annualCanonCents < 0n ||
      input.redemptionCents === undefined ||
      input.redemptionCents < 0n
    )
      throw new Error("DATI_ENFITEUSI_MANCANTI");
    const twentyAnnualPayments = input.annualCanonCents * 20n;
    const ownershipLessRedemption = nonNegative(possessedValue - input.redemptionCents);
    return twentyAnnualPayments > ownershipLessRedemption
      ? twentyAnnualPayments
      : ownershipLessRedemption;
  }
  if (input.age === undefined) throw new Error("ETA_MANCANTE");
  const coefficient = BigInt(usufructCoefficientForAge(input.age));
  const valuationBasisPoints = BigInt(
    annualFiscalValuesFor(input.openingDate).valuationInterestFloorBasisPoints,
  );
  const enjoymentValue = divideRoundedHalfUp(
    possessedValue * valuationBasisPoints * coefficient,
    10_000n,
  );
  return input.right === "bare-ownership"
    ? nonNegative(possessedValue - enjoymentValue)
    : enjoymentValue;
}

export function calculateSplitRealRightValues(input: {
  fullOwnershipCents: bigint;
  possession: Fraction;
  openingDate: string;
  bareOwnershipShare: Fraction;
  usufructShares: Array<{ beneficiaryId: string; share: Fraction; age: number }>;
}): { bareOwnershipCents: bigint; usufructByBeneficiary: Record<string, bigint> } {
  const possessedValue = applyFraction(input.fullOwnershipCents, input.possession);
  const usufructByBeneficiary = Object.fromEntries(
    input.usufructShares.map(({ beneficiaryId, share, age }) => [
      beneficiaryId,
      calculateRealRightValueCents({
        fullOwnershipCents: possessedValue,
        possession: share,
        right: "usufruct",
        openingDate: input.openingDate,
        age,
      }),
    ]),
  );
  const bareOwnershipBase = applyFraction(possessedValue, input.bareOwnershipShare);
  const usufructTotal = Object.values(usufructByBeneficiary).reduce(
    (sum, value) => sum + value,
    0n,
  );
  if (usufructTotal > bareOwnershipBase) throw new Error("DIRITTI_NON_QUADRATI");
  return {
    bareOwnershipCents: bareOwnershipBase - usufructTotal,
    usufructByBeneficiary,
  };
}

const BUILDING_MULTIPLIERS_TENTHS: Record<string, bigint> = {
  A: 1200n,
  A10: 600n,
  B: 1400n,
  C: 1200n,
  C1: 408n,
  D: 600n,
  E: 408n,
};
const FIRST_HOME_CATEGORIES = new Set([
  "A2",
  "A3",
  "A4",
  "A5",
  "A6",
  "A7",
  "A11",
  "C2",
  "C6",
  "C7",
]);

export function calculateBuildingFiscalValueCents(input: {
  cadastralIncomeCents: bigint;
  category: string;
  firstHome: boolean;
  possession: Fraction;
}): bigint {
  if (input.cadastralIncomeCents < 0n) throw new Error("RENDITA_NON_VALIDA");
  const category = input.category.toUpperCase().replaceAll("/", "");
  const group = category[0];
  const key = category === "A10" || category === "C1" ? category : group;
  if (input.firstHome && !FIRST_HOME_CATEGORIES.has(category))
    throw new Error("CATEGORIA_PRIMA_CASA_NON_AMMESSA");
  const multiplierTenths = input.firstHome ? 1100n : BUILDING_MULTIPLIERS_TENTHS[key ?? ""];
  if (!multiplierTenths || group === "F") throw new Error("CATEGORIA_NON_QUALIFICATA");
  const fullValue = divideRoundedHalfUp(
    input.cadastralIncomeCents * 105n * multiplierTenths,
    1_000n,
  );
  return applyFraction(fullValue, input.possession);
}

export function calculateLandFiscalValueCents(
  dominicalIncomeCents: bigint,
  possession: Fraction,
): bigint {
  if (dominicalIncomeCents < 0n) throw new Error("REDDITO_DOMINICALE_NON_VALIDO");
  return applyFraction(divideRoundedHalfUp(dominicalIncomeCents * 1125n, 10n), possession);
}

export function calculateCompanyNetValueCents(input: {
  assetsCents: bigint;
  liabilitiesCents: bigint;
  excludedAssetsCents?: bigint;
  goodwillCents?: bigint;
}): bigint {
  for (const value of [
    input.assetsCents,
    input.liabilitiesCents,
    input.excludedAssetsCents ?? 0n,
    input.goodwillCents ?? 0n,
  ])
    if (value < 0n) throw new Error("VALORE_NON_VALIDO");
  return nonNegative(
    input.assetsCents -
      input.liabilitiesCents -
      (input.excludedAssetsCents ?? 0n) -
      (input.goodwillCents ?? 0n),
  );
}

export function calculateBondAccruedInterestCents(input: {
  capitalCents: bigint;
  annualRateBasisPoints: bigint;
  elapsedDays: bigint;
  couponPeriodDays: bigint;
  paymentsPerYear: bigint;
}): bigint {
  if (
    input.capitalCents < 0n ||
    input.annualRateBasisPoints < 0n ||
    input.elapsedDays < 0n ||
    input.couponPeriodDays <= 0n ||
    input.elapsedDays > input.couponPeriodDays ||
    input.paymentsPerYear <= 0n
  )
    throw new Error("RATEO_NON_VALIDO");
  return divideRoundedHalfUp(
    input.capitalCents * input.annualRateBasisPoints * input.elapsedDays,
    10_000n * input.paymentsPerYear * input.couponPeriodDays,
  );
}

export function calculateDeductibleRecentMaintenanceDebtCents(input: {
  outstandingDebtCents: bigint;
  beneficiaryKind: "decedent" | "dependent-family-member";
  fullMonths: Array<{ taxYear: number; dependentInYear: boolean }>;
}): bigint {
  if (input.outstandingDebtCents < 0n) throw new Error("DEBITO_NON_VALIDO");
  const monthlyLimit = input.beneficiaryKind === "decedent" ? 51_600n : 25_800n;
  const eligibleMonths = input.fullMonths.filter(
    (month) =>
      input.beneficiaryKind === "decedent" ||
      (Number.isInteger(month.taxYear) && month.dependentInYear),
  ).length;
  const limit = BigInt(eligibleMonths) * monthlyLimit;
  return input.outstandingDebtCents < limit ? input.outstandingDebtCents : limit;
}
