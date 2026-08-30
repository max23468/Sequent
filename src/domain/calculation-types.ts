import type { OfficialJurisdictionCounts } from "./municipality-conservatory.ts";

export const SUCCESSION_TAX_RULESET_VERSION = "2026.08.12" as const;

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
  assetExemptValueCents?: bigint;
  businessAsset?: boolean;
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
  provinceCode?: string;
  habitationRightCode?: string;
  landTypeCode?: string;
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
  jurisdictionCounts: OfficialJurisdictionCounts;
  successionTax: {
    calculatedCents: bigint;
    alreadyPaidCents: bigint;
    creditCents: bigint;
    payableCents: bigint;
  };
  penaltiesCents: bigint;
  interestCents: bigint;
  totalAtSubmissionCents: bigint;
  officialFieldValues: Record<string, string>;
  sourceRefs: readonly ["SRC-07", "SRC-08", "SRC-10", "SRC-13", "SRC-14", "SRC-39"];
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
