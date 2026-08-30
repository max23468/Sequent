import type {
  BeneficiaryTaxResult,
  DeclarationTaxSummary,
  SuccessionAllocation,
} from "../../domain/calculation-types.ts";
import type { SuccessionPaymentPlan } from "../../domain/temporal-rules.ts";
import { getCanonicalField, type DeclarationSnapshot } from "../../domain/declaration.ts";
import type { DevolutionIssue, DevolutionShare } from "../../domain/devolution.ts";
import { listQuadroFields, type QuadroId } from "../../domain/official-catalog/catalog.ts";
import type { ValidationIssue } from "../../domain/validation.ts";
import { technicalFieldValue } from "./domain-values.ts";

export type SubjectRole = "decedent" | "beneficiary" | "representative" | "other";
export type AssetCategory = "property" | "financial" | "other_asset" | "liability" | "donation";
export type AssetKind =
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

export const SUCCESSION_OPENING_DATE_FIELD_ID = "frontespizio.defunto.data-decesso";
const SUBSTITUTE_SUCCESSION_OPENING_DATE_FIELD_ID =
  "xsd:/Fornitura/Dichiarazione/QuadroEH/PrimoModulo/SezioneI_DichSost/DatiDefunto/Decesso/DataDecesso";

export function successionOpeningDateDivergenceIssue(
  declaration: DeclarationSnapshot,
): ValidationIssue | null {
  const frontespizioDate = Object.values(declaration.fields).find(
    (field) => field.fieldId === SUCCESSION_OPENING_DATE_FIELD_ID,
  )?.value;
  const substituteDate = getCanonicalField(
    declaration,
    SUBSTITUTE_SUCCESSION_OPENING_DATE_FIELD_ID,
  )?.value;
  if (
    frontespizioDate === null ||
    frontespizioDate === undefined ||
    String(frontespizioDate) === "" ||
    substituteDate === null ||
    substituteDate === undefined ||
    String(substituteDate) === "" ||
    String(frontespizioDate) === String(substituteDate)
  )
    return null;
  return {
    id: "SUCCESSION_OPENING_DATE_DIVERGENCE",
    level: "blocking",
    fieldId: SUBSTITUTE_SUCCESSION_OPENING_DATE_FIELD_ID,
    message:
      "La data del decesso ripetuta nella dichiarazione sostitutiva deve coincidere con quella del Frontespizio.",
    sourceId: "SRC-08",
    sourcePointer: "Frontespizio e Quadro EH — data del decesso",
  };
}

export const ASSET_KIND_DETAILS: Record<
  AssetKind,
  { category: AssetCategory; quadro: QuadroId | null; treatment: SuccessionAllocation["treatment"] }
> = {
  land: { category: "property", quadro: "EB", treatment: "estate" },
  building: { category: "property", quadro: "EC", treatment: "estate" },
  tavolare_land: { category: "property", quadro: "EL", treatment: "estate" },
  tavolare_building: { category: "property", quadro: "EM", treatment: "estate" },
  company: { category: "other_asset", quadro: "EN", treatment: "estate" },
  securities: { category: "financial", quadro: "EO", treatment: "estate" },
  aircraft: { category: "other_asset", quadro: "EP", treatment: "estate" },
  vessel: { category: "other_asset", quadro: "EQ", treatment: "estate" },
  money: { category: "financial", quadro: "ER", treatment: "dn" },
  inventory: { category: "other_asset", quadro: "ER", treatment: "bi" },
  other: { category: "other_asset", quadro: "ER", treatment: "estate" },
  liability: { category: "liability", quadro: "ED", treatment: "liability" },
  donation: { category: "donation", quadro: null, treatment: "estate" },
};

export function assetCatalogField(asset: SharedAsset, name: string) {
  return asset.quadro
    ? (listQuadroFields(asset.quadro).find((field) => field.name === name) ?? null)
    : null;
}

export function officialAssetValueField(asset: SharedAsset) {
  return asset.quadro
    ? (listQuadroFields(asset.quadro).find(
        (field) =>
          field.name === "Valore" &&
          !field.path.includes("/Devoluzione") &&
          !field.path.includes("/Ripartizione"),
      ) ?? null)
    : null;
}

export function officialAssetForeignTaxField(asset: SharedAsset) {
  return assetCatalogField(asset, "ImpostaVersataEstero");
}

export function officialAssetPreviousSuccessionField(asset: SharedAsset) {
  return assetCatalogField(asset, "ValorePrecSucc");
}

export function wholeEurosToCents(value: string): bigint | null {
  return /^\d+$/u.test(value) ? BigInt(value) * 100n : value === "" ? 0n : null;
}

export function technicalWholeEuroCents(
  declaration: DeclarationSnapshot,
  path: string,
): bigint | null {
  return wholeEurosToCents(technicalFieldValue(declaration, path));
}

export const EF_PATH = "/Fornitura/Dichiarazione/QuadroEF";

export function hasAmbiguousTaxPositions(
  declaration: DeclarationSnapshot,
  entries: DeclarationSubjectEntry[],
): boolean {
  if (entries.length < 2) return false;
  const relevantFields = [
    "quadro-ea.soggetto.tipo",
    "quadro-ea.soggetto.grado-parentela",
    "quadro-ea.soggetto.disabilita",
  ];
  const signatures = new Set(
    entries.map((entry) =>
      relevantFields
        .map((fieldId) => String(getCanonicalField(declaration, fieldId, entry.id)?.value ?? ""))
        .join("\u0000"),
    ),
  );
  return signatures.size > 1;
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

export function allocateConservedCents(
  total: bigint,
  shares: Array<{ numerator: bigint; denominator: bigint; index: number }>,
): Map<number, bigint> | null {
  if (
    total < 0n ||
    shares.length === 0 ||
    shares.some(
      (share) =>
        share.numerator <= 0n || share.denominator <= 0n || share.numerator > share.denominator,
    )
  )
    return null;
  let commonDenominator = 1n;
  for (const share of shares)
    commonDenominator =
      (commonDenominator * share.denominator) /
      greatestCommonDivisor(commonDenominator, share.denominator);
  const numeratorTotal = shares.reduce(
    (sum, share) => sum + share.numerator * (commonDenominator / share.denominator),
    0n,
  );
  if (numeratorTotal !== commonDenominator) return null;
  const allocations = shares.map((share) => ({
    ...share,
    value: (total * share.numerator) / share.denominator,
    remainder: (total * share.numerator) % share.denominator,
  }));
  let centsToAssign = total - allocations.reduce((sum, share) => sum + share.value, 0n);
  allocations.sort((left, right) => {
    const leftScaled = left.remainder * right.denominator;
    const rightScaled = right.remainder * left.denominator;
    return leftScaled === rightScaled
      ? left.index - right.index
      : leftScaled > rightScaled
        ? -1
        : 1;
  });
  for (const allocation of allocations) {
    if (centsToAssign <= 0n) break;
    allocation.value += 1n;
    centsToAssign -= 1n;
  }
  return new Map(allocations.map((allocation) => [allocation.index, allocation.value]));
}

export interface SharedSubject {
  id: string;
  practiceId: string;
  role: SubjectRole;
  displayName: string;
  taxCode: string | null;
  data: Record<string, unknown>;
  revision: number;
  updatedAt: string;
}

export interface DeclarationSubjectEntry {
  id: string;
  subjectId: string;
  declarationId: string;
  sequence: number;
  occurrence: number;
  role: SubjectRole;
  displayName: string;
  taxCode: string | null;
}

export interface DeclarationDossierSubject {
  id: string;
  role: SubjectRole;
  displayName: string;
  taxCode: string | null;
}

export interface SharedAsset {
  id: string;
  practiceId: string;
  category: AssetCategory;
  kind: AssetKind;
  quadro: QuadroId | null;
  valueCents: string;
  treatment: SuccessionAllocation["treatment"];
  displayName: string;
  data: Record<string, unknown>;
  revision: number;
  updatedAt: string;
}

export interface DevolutionScenario {
  id: string;
  status: "draft" | "blocked" | "confirmed" | "superseded";
  shares: Array<
    DevolutionShare & {
      reliefCode: string;
      reductionYears: 0 | 1 | 2 | 3 | 4 | 5;
      previousSuccessionValueCents: bigint;
      foreignTaxCents: bigint;
    }
  >;
  issues: DevolutionIssue[];
  updatedAt: string;
}

export interface CalculationRun {
  id: string;
  status: "draft" | "blocked" | "confirmed" | "superseded";
  beneficiaries: BeneficiaryTaxResult[];
  totalTaxCents: bigint;
  declarationTaxes: DeclarationTaxSummary;
  paymentPlan: SuccessionPaymentPlan | null;
  issues: ValidationIssue[];
  updatedAt: string;
}

export interface ChecklistItem {
  id: string;
  requirementKind: "attachment" | "source" | "retain" | "subsequent_proof";
  importance: "blocking" | "conditional" | "recommended";
  label: string;
  status: "missing" | "available" | "not_applicable" | "overridden";
  sourceRefs: string[];
  documentId: string | null;
  decisionNote: string | null;
}
