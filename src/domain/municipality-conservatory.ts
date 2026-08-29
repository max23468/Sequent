import catalog from "./official-catalog/municipality-conservatory-map.json" with { type: "json" };

export type DeclarationKind = "first" | "substitute-1" | "substitute-2" | "substitute-3";

export interface JurisdictionAllocation {
  assetId: string;
  assetKind?: string;
  municipalityCode?: string;
  provinceCode?: string;
  relationshipCode?: string;
  rightCode?: string;
  reliefCode?: string;
}

export interface DeclaredJurisdictionCounts {
  mortgage?: number;
  stampDuty?: number;
}

export interface OfficialJurisdictionCounts {
  mortgage: number;
  stampDuty: number;
  mortgageMaximum: number;
  stampDutyMaximum: number;
  mode: "automatic" | "professional-input";
  declaredCountStatus: {
    mortgage: "not-required" | "valid" | "missing" | "invalid" | "above-maximum";
    stampDuty: "not-required" | "valid" | "missing" | "invalid" | "above-maximum";
  };
  unresolvedMunicipalityCodes: string[];
  sourceRefs: readonly ["SRC-39"];
}

const CONSERVATORY_BY_MUNICIPALITY = new Map(
  Object.entries(catalog.conservatoryByMunicipalityCode),
);

const ORDINARY_PROPERTY_KINDS = new Set(["land", "building"]);
const STAMP_DUTY_EXCLUDED_RELATIONSHIPS = new Set(["36", "37"]);
const STAMP_DUTY_EXCLUDED_RELIEFS = new Set(["C", "M", "G", "E"]);

export function normalizeMunicipalityCode(value: string | undefined): string {
  const normalized = value?.trim().toUpperCase() ?? "";
  if (normalized.length === 5 && normalized !== "G831A" && normalized !== "G831B")
    return normalized.slice(0, 4);
  return normalized;
}

export function conservatoryCodeForMunicipality(
  municipalityCode: string | undefined,
): string | null | undefined {
  return CONSERVATORY_BY_MUNICIPALITY.get(normalizeMunicipalityCode(municipalityCode));
}

function resolveDeclaredCount(
  value: number | undefined,
  maximum: number,
): {
  value: number;
  status: "valid" | "missing" | "invalid" | "above-maximum";
} {
  if (value === undefined) return { value: 0, status: "missing" };
  if (!Number.isInteger(value) || value < 0) return { value: 0, status: "invalid" };
  if (value > maximum) return { value: 0, status: "above-maximum" };
  return { value, status: "valid" };
}

export function calculateOfficialJurisdictionCounts(
  allocations: JurisdictionAllocation[],
  declarationKind: DeclarationKind,
  declared: DeclaredJurisdictionCounts = {},
): OfficialJurisdictionCounts {
  if (declarationKind === "substitute-2")
    return {
      mortgage: 0,
      stampDuty: 0,
      mortgageMaximum: 0,
      stampDutyMaximum: 0,
      mode: "automatic",
      declaredCountStatus: { mortgage: "not-required", stampDuty: "not-required" },
      unresolvedMunicipalityCodes: [],
      sourceRefs: ["SRC-39"],
    };

  const byAsset = new Map<string, JurisdictionAllocation[]>();
  for (const allocation of allocations) {
    if (
      !ORDINARY_PROPERTY_KINDS.has(allocation.assetKind ?? "") ||
      allocation.provinceCode?.trim().toUpperCase() === "EE"
    )
      continue;
    const group = byAsset.get(allocation.assetId) ?? [];
    group.push(allocation);
    byAsset.set(allocation.assetId, group);
  }

  const mortgageConservatories = new Set<string>();
  const stampDutyConservatories = new Set<string>();
  const unresolvedMunicipalityCodes = new Set<string>();
  for (const assetAllocations of byAsset.values()) {
    const municipalityCode = normalizeMunicipalityCode(assetAllocations[0]?.municipalityCode);
    const conservatoryCode = conservatoryCodeForMunicipality(municipalityCode);
    if (conservatoryCode === undefined) {
      unresolvedMunicipalityCodes.add(municipalityCode);
      continue;
    }
    if (conservatoryCode === null) continue;

    const mortgageExcluded = assetAllocations.some(
      (allocation) =>
        allocation.relationshipCode === "36" ||
        allocation.rightCode === "10" ||
        allocation.reliefCode?.trim().toUpperCase() === "H",
    );
    if (!mortgageExcluded) mortgageConservatories.add(conservatoryCode);

    const stampDutyExcludedByReliefH = assetAllocations.some(
      (allocation) => allocation.reliefCode?.trim().toUpperCase() === "H",
    );
    const hasStampDutyRelevantAllocation =
      !stampDutyExcludedByReliefH &&
      assetAllocations.some((allocation) => {
        const reliefCode = allocation.reliefCode?.trim().toUpperCase() ?? "";
        return (
          !STAMP_DUTY_EXCLUDED_RELATIONSHIPS.has(allocation.relationshipCode ?? "") &&
          allocation.rightCode !== "10" &&
          !STAMP_DUTY_EXCLUDED_RELIEFS.has(reliefCode)
        );
      });
    if (hasStampDutyRelevantAllocation) stampDutyConservatories.add(conservatoryCode);
  }

  const mortgageMaximum = mortgageConservatories.size;
  const stampDutyMaximum = stampDutyConservatories.size;
  const professionalInput = declarationKind === "substitute-1";
  const declaredMortgage = resolveDeclaredCount(declared.mortgage, mortgageMaximum);
  const declaredStampDuty = resolveDeclaredCount(declared.stampDuty, stampDutyMaximum);
  return {
    mortgage: professionalInput ? declaredMortgage.value : mortgageMaximum,
    stampDuty: professionalInput ? declaredStampDuty.value : stampDutyMaximum,
    mortgageMaximum,
    stampDutyMaximum,
    mode: professionalInput ? "professional-input" : "automatic",
    declaredCountStatus: professionalInput
      ? { mortgage: declaredMortgage.status, stampDuty: declaredStampDuty.status }
      : { mortgage: "not-required", stampDuty: "not-required" },
    unresolvedMunicipalityCodes: [...unresolvedMunicipalityCodes].sort(),
    sourceRefs: ["SRC-39"],
  };
}
