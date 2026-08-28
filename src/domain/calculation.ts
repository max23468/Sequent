import {
  annualFiscalValuesFor,
  applicableLegalFramework,
  usufructCoefficientForAge,
} from "./temporal-rules.ts";

export const SUCCESSION_TAX_RULESET_VERSION = "2026.08.2" as const;

export interface BeneficiaryTaxInput {
  beneficiaryId: string;
  devolvedEstateCents: bigint;
  presumedAssetsCents: bigint;
  allocatedLiabilitiesCents: bigint;
  allowanceCents: bigint;
  rateBasisPoints: bigint;
  reductionsCents: bigint;
  foreignTaxCreditCents: bigint;
  presumptionApplicable: boolean;
}

export interface BeneficiaryTaxResult {
  beneficiaryId: string;
  qe: bigint;
  qdn: bigint;
  qp: bigint;
  an: bigint;
  fr: bigint;
  qn: bigint;
  pr: bigint;
  qti: bigint;
  isl: bigint;
  reductions: bigint;
  foreignTaxCredit: bigint;
  isn: bigint;
  rulesetVersion: typeof SUCCESSION_TAX_RULESET_VERSION;
  sourceRefs: ["SRC-10", "MASTER_PLAN#19.3"];
}

export interface SuccessionAllocation {
  assetId: string;
  beneficiaryId: string;
  treatment: "estate" | "dn" | "bi" | "liability";
  valueCents: bigint;
  assetValueCents: bigint;
  reliefCode?: string;
  reductionYears?: 1 | 2 | 3 | 4 | 5;
  previousSuccessionValueCents?: bigint;
  foreignTaxCents?: bigint;
  assetKind?:
    | "land"
    | "building"
    | "tavolare_land"
    | "tavolare_building"
    | "company"
    | "securities"
    | "aircraft"
    | "vessel"
    | "money"
    | "inventory"
    | "other"
    | "liability"
    | "donation";
  municipalityCode?: string;
  relationshipCode?: string;
  subjectType?: string;
  rightCode?: string;
}

export interface TaxBeneficiary {
  id: string;
  relationshipCode: string;
  subjectType: string;
  disabled: boolean;
}

export interface SuccessionTaxRun {
  beneficiaries: BeneficiaryTaxResult[];
  totalTaxCents: bigint;
  rulesetVersion: typeof SUCCESSION_TAX_RULESET_VERSION;
  sourceRefs: ["SRC-10"];
}

export interface DeclarationTaxSummary {
  assessmentMode: "self-assessment" | "office-assessment";
  estate: {
    propertyCents: bigint;
    companiesCents: bigint;
    securitiesCents: bigint;
    aircraftAndVesselsCents: bigint;
    otherAssetsCents: bigint;
    totalAssetsCents: bigint;
    totalLiabilitiesCents: bigint;
    netEstateCents: bigint;
  };
  mortgageTax: {
    taxableCents: bigint;
    dueCents: bigint;
    alreadyPaidCents: bigint;
    creditCents: bigint;
    payableCents: bigint;
  };
  cadastralTax: {
    taxableCents: bigint;
    dueCents: bigint;
    alreadyPaidCents: bigint;
    creditCents: bigint;
    payableCents: bigint;
  };
  mortgageServicesCents: bigint;
  stampDutyCents: bigint;
  specialTaxesCents: bigint;
  successionTax: {
    calculatedCents: bigint;
    alreadyPaidCents: bigint;
    creditCents: bigint;
    payableCents: bigint;
  };
  penaltiesCents: bigint;
  interestCents: bigint;
  totalAtSubmissionCents: bigint;
  sourceRefs: readonly ["SRC-07", "SRC-08", "SRC-10", "SRC-13", "SRC-14"];
}

export interface Fraction {
  numerator: bigint;
  denominator: bigint;
}

export type RealRight =
  | "full-ownership"
  | "bare-ownership"
  | "usufruct"
  | "use"
  | "habitation"
  | "emphyteusis"
  | "grantor";

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

export interface DeclarationTaxOptions {
  openingDate: string;
  jurisdictionCount: number;
  automaticLandRegistry: boolean;
  copyRequested: boolean;
  paymentTiming: 1 | 2;
  initialSuccessionPaymentCents?: bigint;
  mortgageAlreadyPaidCents?: bigint;
  mortgageCreditCents?: bigint;
  cadastralAlreadyPaidCents?: bigint;
  cadastralCreditCents?: bigint;
  successionAlreadyPaidCents?: bigint;
  successionCreditCents?: bigint;
  penaltiesCents?: bigint[];
  interestCents?: bigint[];
}

const DIRECT_LINE = new Set([
  "01",
  "02",
  "03",
  "04",
  "5A",
  "5B",
  "06",
  "7A",
  "7B",
  "08",
  "9A",
  "9B",
]);
const SIBLINGS = new Set(["10", "11"]);
const SIX_PERCENT = new Set([
  "10",
  "11",
  "12",
  "13",
  "14",
  "15",
  "15A",
  "16",
  "17",
  "18",
  "19",
  "20",
  "21",
  "22",
  "23",
  "24",
  "25",
  "26",
]);
const TAX_EXEMPT = new Set(["36", "37", "38", "39"]);
const EXEMPT_RELIEF_CODES = new Set(["A", "D", "C", "G", "N", "E", "H"]);

function nonNegative(value: bigint): bigint {
  return value > 0n ? value : 0n;
}

function divideRoundedHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) return 0n;
  return (numerator + denominator / 2n) / denominator;
}

function divideTruncated(numerator: bigint, denominator: bigint): bigint {
  return denominator <= 0n ? 0n : numerator / denominator;
}

function roundToWholeEuro(valueCents: bigint): bigint {
  if (valueCents <= 0n) return 0n;
  return ((valueCents + 50n) / 100n) * 100n;
}

function positiveDifference(...values: bigint[]): bigint {
  return nonNegative(
    values.reduce((result, value, index) => (index === 0 ? value : result - value), 0n),
  );
}

const PROPERTY_KINDS = new Set<SuccessionAllocation["assetKind"]>([
  "land",
  "building",
  "tavolare_land",
  "tavolare_building",
]);
const PROPORTIONAL_PROPERTY_RELIEFS = new Set(["", "A", "L", "R", "F", "N", "Q"]);

function groupAllocationsByAsset(
  allocations: SuccessionAllocation[],
): Array<{ assetId: string; allocations: SuccessionAllocation[]; valueCents: bigint }> {
  const groups = new Map<string, SuccessionAllocation[]>();
  for (const allocation of allocations) {
    const group = groups.get(allocation.assetId) ?? [];
    group.push(allocation);
    groups.set(allocation.assetId, group);
  }
  return [...groups.entries()].map(([assetId, groupedAllocations]) => ({
    assetId,
    allocations: groupedAllocations,
    valueCents: groupedAllocations.reduce((sum, allocation) => sum + allocation.valueCents, 0n),
  }));
}

export function calculateDeclarationTaxSummary(
  allocations: SuccessionAllocation[],
  successionTaxCents: bigint,
  options: DeclarationTaxOptions,
): DeclarationTaxSummary {
  if (!Number.isInteger(options.jurisdictionCount) || options.jurisdictionCount < 0)
    throw new Error("NUMERO_CIRCOSCRIZIONI_NON_VALIDO");
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(options.openingDate)) throw new Error("DATA_NON_VALIDA");
  const assessmentMode = applicableLegalFramework(options.openingDate).assessmentMode;
  const assetGroups = groupAllocationsByAsset(allocations);
  const hasRelief = (group: (typeof assetGroups)[number], code: string) =>
    group.allocations.some((allocation) => (allocation.reliefCode?.toUpperCase() ?? "") === code);
  const groupKind = (group: (typeof assetGroups)[number]) => group.allocations[0]?.assetKind;
  const sumKinds = (
    kinds: Set<SuccessionAllocation["assetKind"]>,
    excludedReliefs = new Set<string>(),
  ) =>
    assetGroups.reduce(
      (sum, group) =>
        kinds.has(groupKind(group)) && ![...excludedReliefs].some((code) => hasRelief(group, code))
          ? sum + group.valueCents
          : sum,
      0n,
    );
  const propertyCents = sumKinds(PROPERTY_KINDS, new Set(["A"]));
  const companiesCents = sumKinds(new Set(["company"]));
  const securitiesCents = sumKinds(new Set(["securities"]));
  const aircraftAndVesselsCents = sumKinds(new Set(["aircraft", "vessel"]), new Set(["A"]));
  const otherAssetsCents = sumKinds(new Set(["money", "inventory", "other"]), new Set(["A"]));
  const totalLiabilitiesCents = sumKinds(new Set(["liability"]));
  const totalAssetsCents =
    propertyCents + companiesCents + securitiesCents + aircraftAndVesselsCents + otherAssetsCents;
  const propertyGroups = assetGroups.filter((group) => PROPERTY_KINDS.has(groupKind(group)));
  const groupReliefs = (group: (typeof assetGroups)[number]) =>
    new Set(group.allocations.map((allocation) => allocation.reliefCode?.toUpperCase() ?? ""));
  const hasTrustBeneficiary = (group: (typeof assetGroups)[number]) =>
    group.allocations.some((allocation) => allocation.subjectType === "5");
  const taxablePropertyCents = propertyGroups.reduce((sum, group) => {
    const reliefs = groupReliefs(group);
    const onlyProportional = [...reliefs].every((code) => PROPORTIONAL_PROPERTY_RELIEFS.has(code));
    return onlyProportional && !hasTrustBeneficiary(group) ? sum + group.valueCents : sum;
  }, 0n);
  const fixedG = propertyGroups.some((group) => hasRelief(group, "G")) ? 20_000 : 0;
  const fixedM = propertyGroups.some((group) => hasRelief(group, "M")) ? 20_000 : 0;
  const fixedTrust = propertyGroups.some(hasTrustBeneficiary) ? 20_000 : 0;
  const firstHomeCount = propertyGroups.filter((group) =>
    ["P", "Y", "Z"].some((code) => hasRelief(group, code)),
  ).length;
  const firstHomeFixed = firstHomeCount * 20_000;
  const proportionalMortgage = roundToWholeEuro((taxablePropertyCents * 2n) / 100n);
  const proportionalCadastral = roundToWholeEuro(taxablePropertyCents / 100n);
  const mortgageDue =
    taxablePropertyCents > 0n
      ? [
          proportionalMortgage + BigInt(fixedG + fixedM + fixedTrust + firstHomeFixed),
          20_000n,
        ].reduce((maximum, value) => (value > maximum ? value : maximum), 0n)
      : BigInt(fixedG + fixedM + fixedTrust + firstHomeFixed);
  const cadastralDue =
    taxablePropertyCents > 0n
      ? [proportionalCadastral + BigInt(fixedTrust + firstHomeFixed), 20_000n].reduce(
          (maximum, value) => (value > maximum ? value : maximum),
          0n,
        )
      : BigInt(fixedTrust + firstHomeFixed);
  const mortgageAlreadyPaid = options.mortgageAlreadyPaidCents ?? 0n;
  const mortgageCredit = options.mortgageCreditCents ?? 0n;
  const cadastralAlreadyPaid = options.cadastralAlreadyPaidCents ?? 0n;
  const cadastralCredit = options.cadastralCreditCents ?? 0n;
  const successionAlreadyPaid = options.successionAlreadyPaidCents ?? 0n;
  const successionCredit = options.successionCreditCents ?? 0n;
  const mortgagePayable = roundToWholeEuro(
    positiveDifference(mortgageDue, mortgageAlreadyPaid, mortgageCredit),
  );
  const cadastralPayable = roundToWholeEuro(
    positiveDifference(cadastralDue, cadastralAlreadyPaid, cadastralCredit),
  );
  const successionDifference = positiveDifference(
    successionTaxCents,
    successionAlreadyPaid,
    successionCredit,
  );
  const successionPayable = successionDifference <= 1_000n ? 0n : successionDifference;
  const mortgageServicesCents =
    BigInt(options.jurisdictionCount) * BigInt(options.automaticLandRegistry ? 12_000 : 6_500);
  const stampDutyCents =
    BigInt(options.jurisdictionCount) * 8_500n + (options.copyRequested ? 3_200n : 0n);
  const specialTaxesCents = options.copyRequested ? 1_600n : 0n;
  const penaltiesCents = (options.penaltiesCents ?? []).reduce((sum, value) => sum + value, 0n);
  const interestCents = (options.interestCents ?? []).reduce((sum, value) => sum + value, 0n);
  const successionAtSubmission =
    assessmentMode === "self-assessment" && options.paymentTiming === 2
      ? (options.initialSuccessionPaymentCents ?? successionPayable)
      : 0n;
  return {
    assessmentMode,
    estate: {
      propertyCents,
      companiesCents,
      securitiesCents,
      aircraftAndVesselsCents,
      otherAssetsCents,
      totalAssetsCents,
      totalLiabilitiesCents,
      netEstateCents: totalAssetsCents - totalLiabilitiesCents,
    },
    mortgageTax: {
      taxableCents: taxablePropertyCents,
      dueCents: mortgageDue,
      alreadyPaidCents: mortgageAlreadyPaid,
      creditCents: mortgageCredit,
      payableCents: mortgagePayable,
    },
    cadastralTax: {
      taxableCents: taxablePropertyCents,
      dueCents: cadastralDue,
      alreadyPaidCents: cadastralAlreadyPaid,
      creditCents: cadastralCredit,
      payableCents: cadastralPayable,
    },
    mortgageServicesCents,
    stampDutyCents,
    specialTaxesCents,
    successionTax: {
      calculatedCents: successionTaxCents,
      alreadyPaidCents: successionAlreadyPaid,
      creditCents: successionCredit,
      payableCents: successionPayable,
    },
    penaltiesCents,
    interestCents,
    totalAtSubmissionCents:
      mortgagePayable +
      cadastralPayable +
      mortgageServicesCents +
      stampDutyCents +
      specialTaxesCents +
      successionAtSubmission +
      penaltiesCents +
      interestCents,
    sourceRefs: ["SRC-07", "SRC-08", "SRC-10", "SRC-13", "SRC-14"],
  };
}

function taxTreatmentFor(
  relationshipCode: string,
  disabled: boolean,
): { allowanceCents: bigint; rateBasisPoints: bigint } {
  const normalized = relationshipCode.toUpperCase();
  const ordinaryAllowance = DIRECT_LINE.has(normalized)
    ? 100_000_000n
    : SIBLINGS.has(normalized)
      ? 10_000_000n
      : 0n;
  const allowanceCents = disabled
    ? ordinaryAllowance > 150_000_000n
      ? ordinaryAllowance
      : 150_000_000n
    : ordinaryAllowance;
  const rateBasisPoints = TAX_EXEMPT.has(normalized)
    ? 0n
    : DIRECT_LINE.has(normalized)
      ? 400n
      : SIX_PERCENT.has(normalized)
        ? 600n
        : 800n;
  return { allowanceCents, rateBasisPoints };
}

export function calculateBeneficiaryTax(input: BeneficiaryTaxInput): BeneficiaryTaxResult {
  const an =
    input.devolvedEstateCents + input.presumedAssetsCents - input.allocatedLiabilitiesCents;
  const qn = an - input.allowanceCents;
  const qnPositive = nonNegative(qn);
  const pr = input.presumptionApplicable
    ? nonNegative(
        ((qnPositive - input.presumedAssetsCents) * 1_000n) / 10_000n - input.presumedAssetsCents,
      )
    : 0n;
  const qti = qnPositive + pr;
  const isl = (qti * input.rateBasisPoints) / 10_000n;
  const isn = nonNegative(isl - input.reductionsCents - input.foreignTaxCreditCents);
  return {
    beneficiaryId: input.beneficiaryId,
    qe: input.devolvedEstateCents,
    qdn: input.presumedAssetsCents,
    qp: input.allocatedLiabilitiesCents,
    an,
    fr: input.allowanceCents,
    qn,
    pr,
    qti,
    isl,
    reductions: input.reductionsCents,
    foreignTaxCredit: input.foreignTaxCreditCents,
    isn,
    rulesetVersion: SUCCESSION_TAX_RULESET_VERSION,
    sourceRefs: ["SRC-10", "MASTER_PLAN#19.3"],
  };
}

function reliefReduction(allocation: SuccessionAllocation, isl: bigint, qe: bigint): bigint {
  const code = allocation.reliefCode?.toUpperCase();
  if (!code || !["L", "Q", "R", "F"].includes(code) || qe <= 0n) return 0n;
  const cappedValue =
    (code === "R" || code === "F") && allocation.valueCents > 10_329_100n
      ? 10_329_100n
      : allocation.valueCents;
  const proportionalTax = divideRoundedHalfUp(cappedValue * isl, qe);
  const multiplier = code === "L" ? 5_000n : 4_000n;
  return divideRoundedHalfUp(proportionalTax * multiplier, 10_000n);
}

function article25Reduction(allocation: SuccessionAllocation, isl: bigint, qe: bigint): bigint {
  const years = allocation.reductionYears;
  const previous = allocation.previousSuccessionValueCents ?? 0n;
  if (!years || previous <= 0n || allocation.assetValueCents <= 0n || qe <= 0n) return 0n;
  const r25 = divideRoundedHalfUp(
    previous * allocation.valueCents * isl,
    allocation.assetValueCents * qe,
  );
  return divideRoundedHalfUp(r25 * BigInt(6 - years), 10n);
}

function foreignTaxCredit(allocations: SuccessionAllocation[], isl: bigint, qe: bigint): bigint {
  if (qe <= 0n) return 0n;
  return allocations.reduce((sum, allocation) => {
    const paid = allocation.foreignTaxCents ?? 0n;
    if (paid <= 0n) return sum;
    // SRC-10 espone 82,08 nell’esempio 6.567 × 2.500 / 200.000: la quota
    // italiana viene quindi troncata al centesimo, come nell’esito ufficiale.
    const italianLimit = divideTruncated(allocation.valueCents * isl, qe);
    return sum + (paid < italianLimit ? paid : italianLimit);
  }, 0n);
}

export function calculateSuccessionTax(
  beneficiaries: TaxBeneficiary[],
  allocations: SuccessionAllocation[],
): SuccessionTaxRun {
  const hasInventory = allocations.some((allocation) => allocation.treatment === "bi");
  const results = beneficiaries.map((beneficiary) => {
    const assigned = allocations.filter(
      (allocation) => allocation.beneficiaryId === beneficiary.id,
    );
    const qe = assigned.reduce(
      (sum, allocation) =>
        allocation.treatment === "estate" &&
        !EXEMPT_RELIEF_CODES.has(allocation.reliefCode?.toUpperCase() ?? "")
          ? sum + allocation.valueCents
          : sum,
      0n,
    );
    const qdn = assigned.reduce(
      (sum, allocation) => (allocation.treatment === "dn" ? sum + allocation.valueCents : sum),
      0n,
    );
    const qp = assigned.reduce(
      (sum, allocation) =>
        allocation.treatment === "liability" ? sum + allocation.valueCents : sum,
      0n,
    );
    const treatment = taxTreatmentFor(beneficiary.relationshipCode, beneficiary.disabled);
    const provisional = calculateBeneficiaryTax({
      beneficiaryId: beneficiary.id,
      devolvedEstateCents: qe,
      presumedAssetsCents: qdn,
      allocatedLiabilitiesCents: qp,
      allowanceCents: treatment.allowanceCents,
      rateBasisPoints: treatment.rateBasisPoints,
      reductionsCents: 0n,
      foreignTaxCreditCents: 0n,
      presumptionApplicable: !hasInventory && beneficiary.subjectType !== "2",
    });
    const reductions = assigned.reduce(
      (sum, allocation) =>
        sum +
        reliefReduction(allocation, provisional.isl, provisional.qe) +
        article25Reduction(allocation, provisional.isl, provisional.qe),
      0n,
    );
    const credit = foreignTaxCredit(assigned, provisional.isl, provisional.qe);
    return calculateBeneficiaryTax({
      beneficiaryId: beneficiary.id,
      devolvedEstateCents: qe,
      presumedAssetsCents: qdn,
      allocatedLiabilitiesCents: qp,
      allowanceCents: treatment.allowanceCents,
      rateBasisPoints: treatment.rateBasisPoints,
      reductionsCents: reductions,
      foreignTaxCreditCents: credit,
      presumptionApplicable: !hasInventory && beneficiary.subjectType !== "2",
    });
  });
  return {
    beneficiaries: results,
    totalTaxCents: results.reduce((sum, result) => sum + result.isn, 0n),
    rulesetVersion: SUCCESSION_TAX_RULESET_VERSION,
    sourceRefs: ["SRC-10"],
  };
}
