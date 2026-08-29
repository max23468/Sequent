import type { DeclarationSnapshot } from "./declaration.ts";
import { listQuadroFields, type QuadroId } from "./official-catalog/catalog.ts";

export const SEQUENT_PRODUCT_IDENTIFIER = "SEQUENT";

const COMPILED_QUADRI = [
  "EA",
  "EB",
  "EC",
  "ED",
  "EE",
  "EF",
  "EG",
  "EH",
  "EI",
  "EL",
  "EM",
  "EN",
  "EO",
  "EP",
  "EQ",
  "ER",
] as const satisfies readonly QuadroId[];

const FIELD_IDS_BY_QUADRO = new Map(
  COMPILED_QUADRI.map((quadro) => [
    quadro,
    new Set(listQuadroFields(quadro).map((field) => field.canonicalId)),
  ]),
);

function hasMeaningfulValue(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

function hasQuadroData(
  declaration: DeclarationSnapshot,
  quadro: (typeof COMPILED_QUADRI)[number],
  calculatedValues: Readonly<Record<string, string>>,
): boolean {
  const fieldIds = FIELD_IDS_BY_QUADRO.get(quadro)!;
  if (
    Object.values(declaration.fields).some(
      (field) => fieldIds.has(field.fieldId) && hasMeaningfulValue(field.value),
    )
  )
    return true;
  return Object.entries(calculatedValues).some(
    ([fieldId, value]) => fieldIds.has(fieldId) && hasMeaningfulValue(value),
  );
}

export function addSnapshotAutomaticOfficialFieldValues(
  declaration: DeclarationSnapshot,
  calculatedValues: Readonly<Record<string, string>>,
): Record<string, string> {
  const result = { ...calculatedValues };
  result["xsd:/Fornitura/Dichiarazione/Frontespizio/IdentificativoProdSoftware"] =
    SEQUENT_PRODUCT_IDENTIFIER;
  for (const quadro of COMPILED_QUADRI)
    result[`xsd:/Fornitura/Dichiarazione/Frontespizio/FirmaModello/Casella${quadro}`] =
      hasQuadroData(declaration, quadro, calculatedValues) ? "1" : "0";
  return result;
}
