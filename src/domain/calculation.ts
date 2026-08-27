export const SUCCESSION_TAX_RULESET_VERSION = "2025.01.1" as const;

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
