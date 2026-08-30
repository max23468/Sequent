import { applicableLegalFramework } from "./temporal-rules.ts";
import { calculateOfficialJurisdictionCounts } from "./municipality-conservatory.ts";
import { positiveDifference, roundToWholeEuro, divideRoundedHalfUp } from "./calculation-math.ts";
import type { DeclarationTaxSummary, SuccessionAllocation } from "./calculation-types.ts";

export interface DeclarationTaxOptions {
  openingDate: string;
  declaredMortgageJurisdictionCount?: number;
  declaredStampDutyJurisdictionCount?: number;
  automaticLandRegistry: boolean;
  copyRequested: boolean;
  hasTestament?: boolean;
  presenterCode?: string;
  allBeneficiariesDisabled?: boolean;
  substituteType?: "1" | "2" | "3";
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

const PROPERTY_KINDS = new Set<SuccessionAllocation["assetKind"]>([
  "land",
  "building",
  "tavolare_land",
  "tavolare_building",
]);
const BUILDING_KINDS = new Set<SuccessionAllocation["assetKind"]>([
  "building",
  "tavolare_building",
]);
const LAND_KINDS = new Set<SuccessionAllocation["assetKind"]>(["land", "tavolare_land"]);
const FIRST_HOME_EXCLUDED_RELATIONSHIPS = new Set(["36", "37", "38", "39"]);
const FIRST_HOME_RELIEFS = new Set(["P", "X", "Y", "Z"]);
const FIRST_HOME_HABITATION_RIGHTS = new Set(["1", "2", "3", "5", "6", "7"]);
const PRIMARY_HOME_HABITATION_RIGHTS = new Set(["1", "5"]);
const ALTERNATIVE_HOME_HABITATION_RIGHTS = new Set(["2", "6"]);
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
  return [...groups.entries()].map(([assetId, groupedAllocations]) => {
    const officialValues = new Set(
      groupedAllocations.map(({ assetValueCents }) => assetValueCents),
    );
    if (officialValues.size !== 1) throw new Error("VALORE_FISCALE_BENE_NON_COHERENTE");
    return {
      assetId,
      allocations: groupedAllocations,
      valueCents: groupedAllocations[0]?.assetValueCents ?? 0n,
    };
  });
}

export function calculateDeclarationTaxSummary(
  allocations: SuccessionAllocation[],
  successionTaxCents: bigint,
  options: DeclarationTaxOptions,
): DeclarationTaxSummary {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(options.openingDate)) throw new Error("DATA_NON_VALIDA");
  const declarationKind = options.substituteType
    ? (`substitute-${options.substituteType}` as const)
    : "first";
  const jurisdictionCounts = calculateOfficialJurisdictionCounts(allocations, declarationKind, {
    mortgage: options.declaredMortgageJurisdictionCount,
    stampDuty: options.declaredStampDutyJurisdictionCount,
  });
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
  const propertyCents = assetGroups.reduce(
    (sum, group) =>
      PROPERTY_KINDS.has(groupKind(group)) &&
      !hasRelief(group, "A") &&
      !group.allocations.some((allocation) => allocation.businessAsset)
        ? sum + group.valueCents
        : sum,
    0n,
  );
  const companiesCents = sumKinds(new Set(["company"]));
  const securitiesCents = assetGroups.reduce(
    (sum, group) =>
      groupKind(group) === "securities"
        ? sum + group.valueCents + (group.allocations[0]?.assetExemptValueCents ?? 0n)
        : sum,
    0n,
  );
  const aircraftAndVesselsCents = sumKinds(new Set(["aircraft", "vessel"]), new Set(["A"]));
  const otherAssetsCents = sumKinds(new Set(["money", "inventory", "other"]), new Set(["A"]));
  const totalLiabilitiesCents = sumKinds(new Set(["liability"]));
  const totalAssetsCents =
    propertyCents + companiesCents + securitiesCents + aircraftAndVesselsCents + otherAssetsCents;
  const propertyGroups = assetGroups.filter((group) => PROPERTY_KINDS.has(groupKind(group)));
  const hasTrustBeneficiary = (group: (typeof assetGroups)[number]) =>
    group.allocations.some((allocation) => allocation.subjectType === "5");
  const trustReliefApplies = (group: (typeof assetGroups)[number]) =>
    options.openingDate >= "2017-01-01" && hasTrustBeneficiary(group);
  const habitationRight = (group: (typeof assetGroups)[number]) =>
    group.allocations.find((allocation) => allocation.habitationRightCode)?.habitationRightCode ??
    "";
  const proportionalValueCents = (group: (typeof assetGroups)[number]) => {
    const firstHomeHabitation = FIRST_HOME_HABITATION_RIGHTS.has(habitationRight(group));
    const extendedFirstHomeRelief = group.allocations.some((allocation) =>
      FIRST_HOME_RELIEFS.has(allocation.reliefCode?.toUpperCase() ?? ""),
    );
    if (
      firstHomeHabitation ||
      extendedFirstHomeRelief ||
      hasRelief(group, "M") ||
      trustReliefApplies(group)
    )
      return 0n;
    const allocatedTotal = group.allocations.reduce(
      (sum, allocation) => sum + allocation.valueCents,
      0n,
    );
    if (allocatedTotal <= 0n) return 0n;
    const proportionalAllocated = group.allocations.reduce(
      (sum, allocation) =>
        PROPORTIONAL_PROPERTY_RELIEFS.has(allocation.reliefCode?.toUpperCase() ?? "")
          ? sum + allocation.valueCents
          : sum,
      0n,
    );
    return divideRoundedHalfUp(group.valueCents * proportionalAllocated, allocatedTotal);
  };
  const taxablePropertyCents = propertyGroups.reduce(
    (sum, group) => sum + proportionalValueCents(group),
    0n,
  );
  const proportionalGPropertyCents = propertyGroups.reduce(
    (sum, group) => (hasRelief(group, "G") ? sum + proportionalValueCents(group) : sum),
    0n,
  );
  const allocatedValueFor = (group: (typeof propertyGroups)[number]) =>
    group.allocations.reduce((sum, allocation) => sum + allocation.valueCents, 0n);
  const reliefGValueCents = propertyGroups.reduce(
    (sum, group) =>
      sum +
      group.allocations.reduce(
        (groupSum, allocation) =>
          allocation.reliefCode?.toUpperCase() === "G"
            ? groupSum + allocation.valueCents
            : groupSum,
        0n,
      ),
    0n,
  );
  const reliefMValueCents = propertyGroups.reduce(
    (sum, group) => (hasRelief(group, "M") ? sum + allocatedValueFor(group) : sum),
    0n,
  );
  const hasReliefG = propertyGroups.some((group) => hasRelief(group, "G"));
  const hasReliefM = propertyGroups.some((group) => hasRelief(group, "M"));
  const historicalFixedTaxCents = options.openingDate >= "2014-01-01" ? 20_000n : 16_800n;
  const fixedG =
    hasReliefG &&
    roundToWholeEuro((proportionalGPropertyCents * 2n) / 100n) < historicalFixedTaxCents
      ? historicalFixedTaxCents
      : 0n;
  const fixedM = hasReliefM ? historicalFixedTaxCents : 0n;
  const fixedTrust = propertyGroups.some(trustReliefApplies) ? 20_000n : 0n;
  const trustValueCents = propertyGroups.reduce(
    (sum, group) => (trustReliefApplies(group) ? sum + allocatedValueFor(group) : sum),
    0n,
  );
  const eligibleFirstHomeAllocations = (group: (typeof assetGroups)[number]) =>
    group.allocations.filter(
      (allocation) =>
        allocation.provinceCode?.toUpperCase() !== "EE" &&
        !FIRST_HOME_EXCLUDED_RELATIONSHIPS.has(allocation.relationshipCode ?? ""),
    );
  const firstHomeUnits = new Set<string>();
  const beneficiariesWithPrimaryHome = new Set<string>();
  for (const group of propertyGroups.filter((candidate) =>
    BUILDING_KINDS.has(groupKind(candidate)),
  )) {
    const eligible = eligibleFirstHomeAllocations(group);
    const primary =
      eligible.length > 0 &&
      (eligible.some((allocation) => allocation.reliefCode?.toUpperCase() === "P") ||
        PRIMARY_HOME_HABITATION_RIGHTS.has(habitationRight(group)));
    if (!primary) continue;
    firstHomeUnits.add(group.assetId);
    for (const allocation of eligible) beneficiariesWithPrimaryHome.add(allocation.beneficiaryId);
  }
  const beneficiariesWithAlternativeHome = new Set<string>();
  for (const group of propertyGroups.filter((candidate) =>
    BUILDING_KINDS.has(groupKind(candidate)),
  )) {
    const eligible = eligibleFirstHomeAllocations(group).filter(
      (allocation) =>
        ["Y", "Z"].includes(allocation.reliefCode?.toUpperCase() ?? "") ||
        ALTERNATIVE_HOME_HABITATION_RIGHTS.has(habitationRight(group)),
    );
    const unrepresented = eligible.filter(
      (allocation) =>
        !beneficiariesWithPrimaryHome.has(allocation.beneficiaryId) &&
        !beneficiariesWithAlternativeHome.has(allocation.beneficiaryId),
    );
    if (unrepresented.length === 0) continue;
    firstHomeUnits.add(group.assetId);
    for (const allocation of eligible)
      beneficiariesWithAlternativeHome.add(allocation.beneficiaryId);
  }
  const firstHomeCount = firstHomeUnits.size;
  const firstHomeValueCents = propertyGroups
    .filter((group) => BUILDING_KINDS.has(groupKind(group)))
    .reduce((sum, group) => {
      const hasFirstHomeRelief = group.allocations.some((allocation) =>
        FIRST_HOME_RELIEFS.has(allocation.reliefCode?.toUpperCase() ?? ""),
      );
      return hasFirstHomeRelief || FIRST_HOME_HABITATION_RIGHTS.has(habitationRight(group))
        ? sum + allocatedValueFor(group)
        : sum;
    }, 0n);
  const firstHomeFixed = BigInt(firstHomeCount) * historicalFixedTaxCents;
  let proportionalMortgage = roundToWholeEuro((taxablePropertyCents * 2n) / 100n);
  let proportionalCadastral = roundToWholeEuro(taxablePropertyCents / 100n);
  const onlyNonBuildingLandWithoutRelief =
    propertyGroups.length > 0 &&
    propertyGroups.every(
      (group) =>
        LAND_KINDS.has(groupKind(group)) &&
        group.allocations.every(
          (allocation) =>
            allocation.landTypeCode === "3" && (allocation.reliefCode?.trim() ?? "") === "",
        ),
    );
  if (onlyNonBuildingLandWithoutRelief) {
    const mortgageWithMinimum =
      proportionalMortgage < historicalFixedTaxCents
        ? historicalFixedTaxCents
        : proportionalMortgage;
    const cadastralWithMinimum =
      proportionalCadastral < historicalFixedTaxCents
        ? historicalFixedTaxCents
        : proportionalCadastral;
    if (taxablePropertyCents < mortgageWithMinimum + cadastralWithMinimum) {
      proportionalMortgage = roundToWholeEuro((taxablePropertyCents * 2n) / 3n);
      proportionalCadastral = taxablePropertyCents - proportionalMortgage;
    } else {
      proportionalMortgage = mortgageWithMinimum;
      proportionalCadastral = cadastralWithMinimum;
    }
  }
  const mortgageDue =
    taxablePropertyCents > 0n
      ? onlyNonBuildingLandWithoutRelief
        ? proportionalMortgage
        : [
            proportionalMortgage + fixedG + fixedM + fixedTrust + firstHomeFixed,
            historicalFixedTaxCents,
          ].reduce((maximum, value) => (value > maximum ? value : maximum), 0n)
      : fixedG + fixedM + fixedTrust + firstHomeFixed;
  const cadastralDue =
    taxablePropertyCents > 0n
      ? onlyNonBuildingLandWithoutRelief
        ? proportionalCadastral
        : [proportionalCadastral + fixedTrust + firstHomeFixed, historicalFixedTaxCents].reduce(
            (maximum, value) => (value > maximum ? value : maximum),
            0n,
          )
      : fixedTrust + firstHomeFixed;
  const mortgageAlreadyPaid = options.mortgageAlreadyPaidCents ?? 0n;
  const mortgageCredit = options.mortgageCreditCents ?? 0n;
  const cadastralAlreadyPaid = options.cadastralAlreadyPaidCents ?? 0n;
  const cadastralCredit = options.cadastralCreditCents ?? 0n;
  const successionAlreadyPaid = options.successionAlreadyPaidCents ?? 0n;
  const successionCredit = options.successionCreditCents ?? 0n;
  const mortgageDifference = roundToWholeEuro(
    positiveDifference(mortgageDue, mortgageAlreadyPaid, mortgageCredit),
  );
  const cadastralDifference = roundToWholeEuro(
    positiveDifference(cadastralDue, cadastralAlreadyPaid, cadastralCredit),
  );
  const substituteMinimumCents = historicalFixedTaxCents;
  const mortgagePayable =
    options.substituteType === "1" &&
    !hasReliefG &&
    !hasReliefM &&
    mortgageDifference > 0n &&
    mortgageDifference < substituteMinimumCents
      ? substituteMinimumCents
      : mortgageDifference;
  const cadastralPayable =
    options.substituteType === "1" &&
    cadastralDifference > 0n &&
    cadastralDifference < substituteMinimumCents
      ? substituteMinimumCents
      : cadastralDifference;
  const roundedSuccessionTaxCents = roundToWholeEuro(successionTaxCents);
  const successionDifference = positiveDifference(
    roundedSuccessionTaxCents,
    successionAlreadyPaid,
    successionCredit,
  );
  const successionPayable = successionDifference <= 1_000n ? 0n : successionDifference;
  const mortgageServicesCents =
    BigInt(jurisdictionCounts.mortgage) * BigInt(options.automaticLandRegistry ? 12_000 : 6_500);
  const propertyAllocations = allocations.filter((allocation) =>
    PROPERTY_KINDS.has(allocation.assetKind),
  );
  const copyStampExempt =
    propertyAllocations.some((allocation) => allocation.relationshipCode === "36") ||
    (options.hasTestament === true &&
      options.presenterCode === "9" &&
      ((options.openingDate >= "2017-01-01" && options.allBeneficiariesDisabled === true) ||
        propertyAllocations.some(
          (allocation) =>
            allocation.subjectType === "5" &&
            ["36", "37"].includes(allocation.relationshipCode ?? ""),
        )));
  const stampDutyCents =
    BigInt(jurisdictionCounts.stampDuty) * 8_500n +
    (options.copyRequested && !copyStampExempt ? 3_200n : 0n);
  const specialTaxesCents = options.copyRequested ? 1_600n : 0n;
  const penaltiesCents = (options.penaltiesCents ?? []).reduce((sum, value) => sum + value, 0n);
  const interestCents = (options.interestCents ?? []).reduce((sum, value) => sum + value, 0n);
  const successionAtSubmission =
    assessmentMode === "self-assessment" && options.paymentTiming === 2
      ? (options.initialSuccessionPaymentCents ?? successionPayable)
      : 0n;
  const wholeEuros = (cents: bigint) => String(cents / 100n);
  const eePath = "xsd:/Fornitura/Dichiarazione/QuadroEE";
  const efPath = "xsd:/Fornitura/Dichiarazione/QuadroEF";
  const officialFieldValues: Record<string, string> = {
    [`${eePath}/TotaleValoreImmobili`]: wholeEuros(propertyCents),
    [`${eePath}/TotaleValoreAziende`]: wholeEuros(companiesCents),
    [`${eePath}/TotaleValoreTitoli`]: wholeEuros(securitiesCents),
    [`${eePath}/TotaleValoreAereiNavi`]: wholeEuros(aircraftAndVesselsCents),
    [`${eePath}/TotaleValoreAltriBeni`]: wholeEuros(otherAssetsCents),
    [`${eePath}/TotaleAttivo`]: wholeEuros(totalAssetsCents),
    [`${eePath}/TotalePassivo`]: wholeEuros(totalLiabilitiesCents),
    [`${eePath}/TotaleValoreAsseEreditarioNetto`]: wholeEuros(
      totalAssetsCents - totalLiabilitiesCents,
    ),
    [`${efPath}/SezioneI_ImpostaIpotecaria/PrimaCasa/PrimaCasa_Numero`]: String(firstHomeCount),
    [`${efPath}/SezioneIV_ImpostaBollo/ImpostaBollo_CopiaConforme`]: options.copyRequested
      ? wholeEuros(copyStampExempt ? 0n : 3_200n)
      : "",
    [`${efPath}/SezioneVBis_ImpostaSuccessione/ImpostaNonDovuta`]:
      options.presenterCode === "9" && options.allBeneficiariesDisabled === true ? "1" : "",
    [`${efPath}/SezioneVI_SanzioniInteressi/TotaleDaVersare/TotaleDaVersare_Sanzioni`]:
      wholeEuros(penaltiesCents),
    [`${efPath}/SezioneI_ImpostaIpotecaria/ImpostaProporzionale/ImpostaProporzionale_Imponibile`]:
      wholeEuros(taxablePropertyCents),
    [`${efPath}/SezioneI_ImpostaIpotecaria/AgevolazioneG/AgevolazioneG_Valore`]:
      wholeEuros(reliefGValueCents),
    [`${efPath}/SezioneI_ImpostaIpotecaria/AgevolazioneM/AgevolazioneM_Valore`]:
      wholeEuros(reliefMValueCents),
    [`${efPath}/SezioneI_ImpostaIpotecaria/TrustDisab/TrustDisab_Valore`]:
      wholeEuros(trustValueCents),
    [`${efPath}/SezioneI_ImpostaIpotecaria/PrimaCasa/AgevolazionePX_Valore`]:
      wholeEuros(firstHomeValueCents),
    [`${efPath}/SezioneII_ImpostaCatastale/ImpostaProporzionale/ImpostaProporzionale_Imponibile`]:
      wholeEuros(taxablePropertyCents),
    [`${efPath}/SezioneII_ImpostaCatastale/ImpostaCatastaleTrustDisab/ImpostaCatastaleTrustDisab_Valore`]:
      wholeEuros(trustValueCents),
    [`${efPath}/SezioneVI_SanzioniInteressi/TotaleDaVersare/TotaleDaVersare_Interessi`]:
      wholeEuros(interestCents),
    [`${efPath}/SezioneI_ImpostaIpotecaria/ImpostaProporzionale/ImpostaProporzionale_Imposta`]:
      wholeEuros(proportionalMortgage),
    [`${efPath}/SezioneI_ImpostaIpotecaria/AgevolazioneG/AgevolazioneG_Imposta`]:
      wholeEuros(fixedG),
    [`${efPath}/SezioneI_ImpostaIpotecaria/AgevolazioneM/AgevolazioneM_Imposta`]:
      wholeEuros(fixedM),
    [`${efPath}/SezioneI_ImpostaIpotecaria/TrustDisab/TrustDisab_Imposta`]: wholeEuros(fixedTrust),
    [`${efPath}/SezioneI_ImpostaIpotecaria/PrimaCasa/PrimaCasa_Imposta`]:
      wholeEuros(firstHomeFixed),
    [`${efPath}/SezioneI_ImpostaIpotecaria/ImpostaIpotecariaDovuta`]: wholeEuros(mortgageDue),
    [`${efPath}/SezioneI_ImpostaIpotecaria/ImpostaIpotecariaDaVersare`]:
      wholeEuros(mortgagePayable),
    [`${efPath}/SezioneII_ImpostaCatastale/ImpostaProporzionale/ImpostaProporzionale_Imposta`]:
      wholeEuros(proportionalCadastral),
    [`${efPath}/SezioneII_ImpostaCatastale/ImpostaCatastaleFissa`]: wholeEuros(firstHomeFixed),
    [`${efPath}/SezioneII_ImpostaCatastale/ImpostaCatastaleTrustDisab/ImpostaCatastaleTrustDisab_Imposta`]:
      wholeEuros(fixedTrust),
    [`${efPath}/SezioneII_ImpostaCatastale/ImpostaCatastaleDovuta`]: wholeEuros(cadastralDue),
    [`${efPath}/SezioneII_ImpostaCatastale/ImpostaCatastaleDaVersare`]:
      wholeEuros(cadastralPayable),
    [`${efPath}/SezioneIII_TassaIpotecaria/Circoscrizioni_Imposta`]:
      wholeEuros(mortgageServicesCents),
    [`${efPath}/SezioneIV_ImpostaBollo/Circoscrizioni_Imposta`]: wholeEuros(stampDutyCents),
    [`${efPath}/SezioneV_TributiSpeciali/CopiaConforme/CopiaConforme_Importo`]:
      wholeEuros(specialTaxesCents),
    [`${efPath}/TotaleDaVersare`]: wholeEuros(
      mortgagePayable +
        cadastralPayable +
        mortgageServicesCents +
        stampDutyCents +
        specialTaxesCents +
        successionAtSubmission +
        penaltiesCents +
        interestCents,
    ),
    [`${efPath}/SezioneVBis_ImpostaSuccessione/ImpostaCalcolata/ImpostaDaVersare`]:
      wholeEuros(successionPayable),
    [`${efPath}/SezioneVBis_ImpostaSuccessione/ImpostaCalcolata/Imposta`]:
      wholeEuros(roundedSuccessionTaxCents),
    ["xsd:/Fornitura/Dichiarazione/Frontespizio/ImportoDaVersare"]: wholeEuros(
      mortgagePayable +
        cadastralPayable +
        mortgageServicesCents +
        stampDutyCents +
        specialTaxesCents +
        successionAtSubmission +
        penaltiesCents +
        interestCents,
    ),
  };
  if (jurisdictionCounts.mode === "automatic") {
    officialFieldValues[`${efPath}/SezioneIII_TassaIpotecaria/Circoscrizioni_Numero`] = String(
      jurisdictionCounts.mortgage,
    );
    officialFieldValues[`${efPath}/SezioneIV_ImpostaBollo/Circoscrizioni_Numero`] = String(
      jurisdictionCounts.stampDuty,
    );
  }
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
    jurisdictionCounts,
    successionTax: {
      calculatedCents: roundedSuccessionTaxCents,
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
    officialFieldValues,
    sourceRefs: ["SRC-07", "SRC-08", "SRC-10", "SRC-13", "SRC-14", "SRC-39"],
  };
}
