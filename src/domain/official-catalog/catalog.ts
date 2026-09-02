import technicalSchema from "./technical-schema.json" with { type: "json" };
import formFields from "./form-fields.json" with { type: "json" };
import semanticRules from "./semantic-rules.json" with { type: "json" };
import calculationRules from "./calculation-rules.json" with { type: "json" };
import deltaOverlays from "./delta-overlays.json" with { type: "json" };
import officialCatalog from "./official-catalog.json" with { type: "json" };
import officialReferences from "./municipality-conservatory-map.json" with { type: "json" };
import { normalizeItalianTypography } from "../italian-typography.ts";

export type OfficialChoiceSource =
  | "place-name"
  | "municipality-code"
  | "tavolare-place-name"
  | "tavolare-municipality-code"
  | "foreign-state-code"
  | "foreign-state-name"
  | "tavolare-municipality";

export interface OfficialChoiceOption {
  value: string;
  label: string;
  provinceCode?: string;
  validFrom?: string;
  validTo?: string;
}

export interface TechnicalElement {
  id: string;
  name: string;
  path: string;
  kind: "container" | "field";
  type: string;
  minOccurs: number;
  maxOccurs: number | "unbounded";
  effectiveMinOccurs: number;
  effectiveMaxOccurs: number | "unbounded";
  choiceGroup: string | null;
  documentation: string[];
  constraints: {
    base?: string;
    facets?: Record<string, string[]>;
    recursive?: boolean;
    unionMemberTypes?: string[];
  };
  sourceId: string;
  sourcePointer: string;
}

export interface CatalogField {
  id: string;
  quadro: string;
  label: string;
  page?: number;
  visibleNumber?: string;
  section?: string;
  saveGroup?: string;
  entityScope?: "decedent" | "subject" | "asset" | "occurrence" | "declaration";
  occurrenceGroup?: string;
  entryMode?: "editable" | "derived";
  derivedFrom?: string;
  control?: "checkbox" | "select" | "combobox";
  choiceSource?: OfficialChoiceSource;
  choiceProvinceFieldId?: string;
  appliesToDeclarationKinds?: Array<"first" | "substitute-1" | "substitute-2" | "substitute-3">;
  options?: Array<{ value: string; label: string }>;
  officialControlCode?: string;
  presentation?: "visible" | "technical-only";
  technicalPath: string;
  technicalType: string;
  status: string;
  sourceIds: string[];
}

export interface OfficialInstruction {
  id: string;
  targetFieldId: string;
  scope: string;
  instruction: string;
  sourceIds: string[];
  sourcePointer: string;
  state: string;
  applicability?: { kind: string };
  effectiveFrom?: string;
  effectiveBasis?: string;
}

const technicalElements = (technicalSchema.elements ?? []) as TechnicalElement[];
const technicalElementsByPath = new Map(
  technicalElements.map((element) => [element.path, element]),
);
const technicalElementsById = new Map(
  technicalElements
    .filter((element) => element.kind === "field")
    .map((element) => [element.id, element]),
);
const technicalTypes = (technicalSchema.types ?? []) as Array<{
  name: string;
  constraints?: {
    base?: string;
    facets?: Record<string, string[]>;
    unionMemberTypes?: string[];
  };
}>;
const technicalTypesByName = new Map(technicalTypes.map((type) => [type.name, type]));
const technicalEnumerationCache = new Map<string, string[]>();
const catalogFieldCache = new Map<string, CatalogField>();
const fieldsByPath = new Map(
  ((formFields.fields ?? []) as CatalogField[]).map((field) => [field.technicalPath, field]),
);
const fieldsById = new Map(
  ((formFields.fields ?? []) as CatalogField[]).map((field) => [field.id, field]),
);
const visibleFieldOrder = new Map(
  ((formFields.fields ?? []) as CatalogField[]).map((field, index) => [field.id, index]),
);

const provinceLabels = new Map([
  ...officialReferences.provinces.map((option) => [option.value, option.label]),
  ["FU", "Fiume"],
  ["PL", "Pola"],
  ["ZA", "Zara"],
  ["EE", "Paese estero"],
] as Array<[string, string]>);
const foreignStateLabels = new Map(
  officialReferences.foreignStates.map((option) => [option.value, option.label]),
);
const registrationOfficeLabels = new Map(
  officialReferences.registrationOffices.map((option) => [option.value, option.label]),
);
const transcriptionOfficeLabels = new Map(
  officialReferences.transcriptionOffices.map((option) => [option.value, option.label]),
);
const tavolareMunicipalityLabels = new Map(
  officialReferences.tavolareMunicipalities.map((option) => [option.value, option.label]),
);
const cadastralCategoryLabels = new Map(
  officialReferences.cadastralCategories.map((option) => [option.value, option.label]),
);

const QUADRO_PAGES: Record<QuadroId, number> = {
  Frontespizio: 2,
  EA: 3,
  EB: 4,
  EC: 5,
  ER: 6,
  ED: 7,
  EE: 8,
  EF: 8,
  EG: 8,
  EH: 9,
  EI: 13,
  EL: 14,
  EM: 15,
  EN: 16,
  EO: 17,
  EP: 18,
  EQ: 18,
};

const ASSET_QUADRI = new Set<QuadroId>([
  "EB",
  "EC",
  "ED",
  "EL",
  "EM",
  "EN",
  "EO",
  "EP",
  "EQ",
  "ER",
]);

const LABEL_OVERRIDES: Record<string, string> = {
  CodiceFiscale: "Codice fiscale",
  CodiceFiscaleDefunto: "Codice fiscale del defunto",
  CodiceDiritto_P: "Codice del diritto del defunto",
  CodiceDiritto_Rip: "Codice del diritto attribuito",
  PossessoNumeratore: "Quota posseduta dal defunto — numeratore",
  PossessoDenominatore: "Quota posseduta dal defunto — denominatore",
  QuotaNumeratore: "Quota attribuita — numeratore",
  QuotaDenominatore: "Quota attribuita — denominatore",
  QuotaValore: "Valore della quota",
  ValorePrecSucc: "Valore da precedenti successioni o donazioni",
  PortatoreHandicap: "Persona con disabilità",
  ImageData: "Contenuto del documento allegato",
  FileName: "Nome del documento",
  FileType: "Formato del documento",
  FileDescription: "Descrizione del documento",
};

function humanize(value: string): string {
  const overridden = LABEL_OVERRIDES[value];
  if (overridden) return overridden;
  const words = value
    .replaceAll("_", " ")
    .replace(/([a-zà-ÿ0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-zà-ÿ])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  return words ? `${words[0]?.toUpperCase() ?? ""}${words.slice(1).toLowerCase()}` : value;
}

function fieldScope(element: TechnicalElement, quadro: QuadroId): CatalogField["entityScope"] {
  if (
    quadro === "Frontespizio" &&
    (element.path.includes("/DatiDefunto/") || element.name === "CodiceFiscaleDefunto")
  )
    return "decedent";
  if (quadro === "EA") return "subject";
  if (ASSET_QUADRI.has(quadro)) return "asset";
  if (repeatableAncestorPath(element)) return "occurrence";
  return "declaration";
}

function parentTechnicalPath(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

function repeatableAncestorPath(element: TechnicalElement): string | null {
  let path = parentTechnicalPath(element.path);
  while (path) {
    const container = technicalElementsByPath.get(path);
    if (container?.maxOccurs === "unbounded" || (container?.maxOccurs ?? 0) > 1) return path;
    path = parentTechnicalPath(path);
  }
  return null;
}

function fieldSection(element: TechnicalElement, quadro: QuadroId): string {
  const parts = element.path.split("/").filter(Boolean);
  const quadroName = quadro === "EI" ? "QuadroEI_new" : `Quadro${quadro}`;
  const quadroIndex = parts.indexOf(quadro === "Frontespizio" ? "Frontespizio" : quadroName);
  const candidates = parts
    .slice(quadroIndex + 1, -1)
    .filter((part) => !["Modulo", "PrimoModulo"].includes(part));
  return humanize(
    candidates.at(-1) ?? (quadro === "Frontespizio" ? "Dati generali" : `Quadro ${quadro}`),
  );
}

function technicalEnumerationValues(element: TechnicalElement): string[] {
  const cached = technicalEnumerationCache.get(element.id);
  if (cached) return cached;
  const values = new Set<string>();
  const visited = new Set<string>();
  const visit = (name: string | undefined) => {
    if (!name || visited.has(name)) return;
    visited.add(name);
    const type = technicalTypesByName.get(name);
    if (!type) return;
    for (const value of type.constraints?.facets?.enumeration ?? []) values.add(value);
    visit(type.constraints?.base);
    for (const member of type.constraints?.unionMemberTypes ?? []) visit(member);
  };
  for (const value of element.constraints.facets?.enumeration ?? []) values.add(value);
  visit(element.type);
  visit(element.constraints.base);
  for (const member of element.constraints.unionMemberTypes ?? []) visit(member);
  const resolved = [...values];
  technicalEnumerationCache.set(element.id, resolved);
  return resolved;
}

function technicalOptionLabel(element: TechnicalElement, value: string): string {
  const source =
    element.name === "CategoriaCatastale"
      ? cadastralCategoryLabels
      : element.name === "UfficioDiRegistrazione" || element.name === "UfficioTerritoriale"
        ? registrationOfficeLabels
        : element.name === "UfficioTrascrizione"
          ? transcriptionOfficeLabels
          : element.name === "CodiceComuneCatastale"
            ? tavolareMunicipalityLabels
            : element.name === "Provincia" || element.name === "ProvinciaNascita"
              ? provinceLabels
              : element.name === "CodiceStatoEstero"
                ? foreignStateLabels
                : null;
  const label = source?.get(value);
  return label ? `${value} — ${label}` : value;
}

function technicalOptions(element: TechnicalElement): Array<{ value: string; label: string }> {
  const values = technicalEnumerationValues(element);
  if (values.length === 0 && element.type.includes("DatoCB_Type"))
    return [
      { value: "0", label: "No" },
      { value: "1", label: "Sì" },
    ];
  return values.map((value) => ({ value, label: technicalOptionLabel(element, value) }));
}

function officialChoiceSource(element: TechnicalElement): OfficialChoiceSource | undefined {
  const isTavolarePlace = element.path.includes("/LuogoTavolare/");
  if (
    isTavolarePlace &&
    (element.name === "CodiceComune" || element.name === "CodiceComuneAmministrativo")
  )
    return "tavolare-municipality-code";
  if (isTavolarePlace && element.name === "ComuneAmministrativo") return "tavolare-place-name";
  if (element.name === "CodiceComune" || element.name === "CodiceComuneAmministrativo")
    return "municipality-code";
  if (
    element.name === "Comune" ||
    element.name === "ComuneNascita" ||
    element.name === "ComuneAmministrativo"
  )
    return "place-name";
  if (element.name === "CodiceStatoEstero") return "foreign-state-code";
  if (element.name === "StatoEstero") return "foreign-state-name";
  if (element.name === "ComuneCatastale") return "tavolare-municipality";
  return undefined;
}

function relatedProvincePath(path: string): string | null {
  if (path.endsWith("/ComuneNascita"))
    return path.replace(/\/ComuneNascita$/u, "/ProvinciaNascita");
  if (path.includes("/Luogo/Italia/")) return path.replace(/\/Italia\/[^/]+$/u, "/Provincia");
  if (path.endsWith("/Comune")) return path.replace(/\/Comune$/u, "/Provincia");
  return null;
}

function relatedProvinceFieldId(element: TechnicalElement): string | undefined {
  const path = relatedProvincePath(element.path);
  if (!path) return undefined;
  const technical = technicalElementsByPath.get(path);
  if (!technical) return undefined;
  return fieldsByPath.get(path)?.id ?? technical.id;
}

function catalogFieldFor(element: TechnicalElement, quadro: QuadroId): CatalogField {
  const cacheKey = `${quadro}\u0000${element.id}`;
  const cached = catalogFieldCache.get(cacheKey);
  if (cached) return cached;
  const curated = fieldsByPath.get(element.path);
  const section = normalizeItalianTypography(curated?.section ?? fieldSection(element, quadro));
  const entityScope = curated?.entityScope ?? fieldScope(element, quadro);
  const options = (curated?.options ?? technicalOptions(element)).map((option) => ({
    ...option,
    label: normalizeItalianTypography(option.label),
  }));
  const choiceSource = curated?.choiceSource ?? officialChoiceSource(element);
  const resolved: CatalogField = {
    id: curated?.id ?? element.id,
    quadro,
    label: normalizeItalianTypography(curated?.label ?? humanize(element.name)),
    page: curated?.page ?? QUADRO_PAGES[quadro],
    visibleNumber: curated?.visibleNumber,
    section,
    saveGroup: normalizeItalianTypography(curated?.saveGroup ?? section),
    entityScope,
    occurrenceGroup:
      entityScope === "occurrence"
        ? (curated?.occurrenceGroup ?? repeatableAncestorPath(element) ?? undefined)
        : undefined,
    entryMode: curated?.entryMode ?? "editable",
    derivedFrom: curated?.derivedFrom,
    control:
      curated?.control ??
      (element.type.includes("DatoCB_Type")
        ? "checkbox"
        : options.length > 80 || choiceSource
          ? "combobox"
          : options.length > 0
            ? "select"
            : undefined),
    choiceSource,
    choiceProvinceFieldId: curated?.choiceProvinceFieldId ?? relatedProvinceFieldId(element),
    appliesToDeclarationKinds: curated?.appliesToDeclarationKinds ?? [],
    options,
    technicalPath: element.path,
    technicalType: element.type,
    presentation: curated?.presentation,
    status: curated?.status ?? "qualified-from-current-technical-source",
    sourceIds: curated?.sourceIds ?? ["SRC-07", "SRC-08"],
  };
  catalogFieldCache.set(cacheKey, resolved);
  return resolved;
}

export const QUADRI = [
  "Frontespizio",
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
] as const;

export type QuadroId = (typeof QUADRI)[number];

function quadroFromPath(path: string): QuadroId | null {
  if (path.includes("/Frontespizio/")) return "Frontespizio";
  const match = path.match(
    /\/Quadro(EA|EB|EC|ED|EE|EF|EG|EH|EI|EL|EM|EN|EO|EP|EQ|ER)(?:_new)?(?:\/|$)/,
  );
  return (match?.[1] as QuadroId | undefined) ?? null;
}

export function listQuadroTechnicalElements(quadro: QuadroId): TechnicalElement[] {
  return technicalElements.filter((element) => quadroFromPath(element.path) === quadro);
}

export function getQuadroActivationRootPath(quadro: QuadroId): string {
  const paths = listQuadroTechnicalElements(quadro)
    .filter((element) => element.kind === "field")
    .map((element) => element.path.split("/").filter(Boolean));
  if (paths.length === 0) return "";
  const common = [...paths[0]!];
  for (const path of paths.slice(1)) {
    while (common.some((part, index) => path[index] !== part)) common.pop();
  }
  return `/${common.join("/")}`;
}

function isSystemManagedTechnicalField(element: TechnicalElement): boolean {
  return element.path.startsWith("/Fornitura/Intestazione/");
}

export function listQuadroFields(quadro: QuadroId): Array<
  TechnicalElement & {
    canonicalId: string;
    label: string;
    page: number | null;
    visibleNumber: string | null;
    section: string | null;
    saveGroup: string | null;
    entityScope: CatalogField["entityScope"];
    occurrenceGroup: string | null;
    entryMode: NonNullable<CatalogField["entryMode"]>;
    derivedFrom: string | null;
    control: CatalogField["control"] | null;
    choiceSource: OfficialChoiceSource | null;
    choiceProvinceFieldId: string | null;
    appliesToDeclarationKinds: NonNullable<CatalogField["appliesToDeclarationKinds"]>;
    options: Array<{ value: string; label: string }>;
    visibleFieldId: string | null;
    visibleStatus: string;
    sourceIds: string[];
    mappingKind: "curated-visible" | "official-control-visible" | "technical-only";
    instructions: OfficialInstruction[];
  }
> {
  return technicalElements
    .filter((element) => element.kind === "field" && quadroFromPath(element.path) === quadro)
    .map((element) => {
      const visible = fieldsByPath.get(element.path);
      const field = catalogFieldFor(element, quadro);
      const technicalOnly = visible?.presentation === "technical-only";
      return {
        ...element,
        canonicalId: field.id,
        label: field.label,
        page: field.page ?? null,
        visibleNumber: field.visibleNumber ?? null,
        section: field.section ?? null,
        saveGroup: field.saveGroup ?? null,
        entityScope: field.entityScope ?? "declaration",
        occurrenceGroup: field.occurrenceGroup ?? null,
        entryMode: field.entryMode ?? "editable",
        derivedFrom: field.derivedFrom ?? null,
        control: field.control ?? null,
        choiceSource: field.choiceSource ?? null,
        choiceProvinceFieldId: field.choiceProvinceFieldId ?? null,
        appliesToDeclarationKinds: field.appliesToDeclarationKinds ?? [],
        options: field.options ?? [],
        visibleFieldId: technicalOnly ? null : field.id,
        visibleStatus: field.status,
        sourceIds: field.sourceIds,
        mappingKind: technicalOnly
          ? ("technical-only" as const)
          : visible?.status === "qualified-from-official-control-description"
            ? ("official-control-visible" as const)
            : ("curated-visible" as const),
        instructions: listOfficialInstructions(field.id),
      };
    })
    .sort((left, right) => {
      const numberDifference =
        Number(left.visibleNumber ?? Number.MAX_SAFE_INTEGER) -
        Number(right.visibleNumber ?? Number.MAX_SAFE_INTEGER);
      if (numberDifference !== 0) return numberDifference;
      return (
        (visibleFieldOrder.get(left.canonicalId) ?? Number.MAX_SAFE_INTEGER) -
        (visibleFieldOrder.get(right.canonicalId) ?? Number.MAX_SAFE_INTEGER)
      );
    });
}

export function getCatalogField(fieldId: string): CatalogField | null {
  const mapped = fieldsById.get(fieldId);
  const element = mapped
    ? technicalElementsByPath.get(mapped.technicalPath)
    : technicalElementsById.get(fieldId);
  const quadro = element ? quadroFromPath(element.path) : null;
  return element && quadro ? catalogFieldFor(element, quadro) : null;
}

function normalizeChoiceSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleUpperCase("it")
    .trim();
}

const referenceChoiceCache = new Map<OfficialChoiceSource, OfficialChoiceOption[]>();
const referenceChoiceValueCache = new Map<OfficialChoiceSource, Set<string>>();

function referenceChoiceOptions(source: OfficialChoiceSource): OfficialChoiceOption[] {
  const cached = referenceChoiceCache.get(source);
  if (cached) return cached;
  const places = source.startsWith("tavolare-")
    ? officialReferences.tavolarePlaces
    : officialReferences.places;
  const options =
    source === "municipality-code" || source === "tavolare-municipality-code"
      ? places.map((place) => ({
          value: place.municipalityCode,
          label: `${place.municipalityCode} — ${place.label}${place.provinceCode ? ` (${place.provinceCode})` : ""}`,
          provinceCode: place.provinceCode || undefined,
          validFrom: place.validFrom,
          validTo: place.validTo,
        }))
      : source === "place-name" || source === "tavolare-place-name"
        ? places.map((place) => ({
            value: place.value,
            label: `${place.label}${place.provinceCode ? ` (${place.provinceCode})` : ""}`,
            provinceCode: place.provinceCode || undefined,
            validFrom: place.validFrom,
            validTo: place.validTo,
          }))
        : source === "foreign-state-code"
          ? officialReferences.foreignStates.map((option) => ({
              value: option.value,
              label: `${option.value} — ${option.label}`,
            }))
          : source === "foreign-state-name"
            ? officialReferences.foreignStates.map((option) => ({
                value: option.label,
                label: option.label,
              }))
            : officialReferences.tavolareMunicipalities.map((option) => ({
                value: option.label,
                label: `${option.label} — ${option.value}`,
              }));
  referenceChoiceCache.set(source, options);
  return options;
}

export function listOfficialChoiceOptions(
  fieldId: string,
  input: {
    query?: string;
    provinceCode?: string;
    effectiveDate?: string;
    limit?: number;
  } = {},
): OfficialChoiceOption[] {
  const field = getCatalogField(fieldId);
  if (!field) return [];
  const sourceOptions: OfficialChoiceOption[] = field.choiceSource
    ? referenceChoiceOptions(field.choiceSource)
    : (field.options ?? []);
  const query = normalizeChoiceSearch(input.query ?? "");
  const provinceCode = input.provinceCode?.trim().toUpperCase() ?? "";
  const effectiveDate = input.effectiveDate?.trim() ?? "";
  const limit = Math.max(1, Math.min(input.limit ?? 60, 100));
  const unique = new Map<string, OfficialChoiceOption>();
  for (const option of sourceOptions) {
    if (provinceCode && option.provinceCode && option.provinceCode !== provinceCode) continue;
    if (
      effectiveDate &&
      ((option.validFrom && option.validFrom > effectiveDate) ||
        (option.validTo && option.validTo < effectiveDate))
    )
      continue;
    const matchesQuery =
      !query ||
      normalizeChoiceSearch(option.value).includes(query) ||
      normalizeChoiceSearch(option.label).includes(query);
    if (!matchesQuery) continue;
    const key = `${option.value}\u0000${option.label}`;
    if (!unique.has(key)) unique.set(key, option);
    if (unique.size >= limit) break;
  }
  return [...unique.values()];
}

export function isOfficialChoiceValue(fieldId: string, value: string): boolean {
  const field = getCatalogField(fieldId);
  if (!field || (!field.choiceSource && (field.options?.length ?? 0) === 0)) return true;
  if (!field.choiceSource) return field.options?.some((option) => option.value === value) ?? false;
  let values = referenceChoiceValueCache.get(field.choiceSource);
  if (!values) {
    values = new Set(referenceChoiceOptions(field.choiceSource).map((option) => option.value));
    referenceChoiceValueCache.set(field.choiceSource, values);
  }
  return values.has(value);
}

export function getTechnicalField(fieldId: string): TechnicalElement | null {
  const catalogField = fieldsById.get(fieldId);
  const technicalPath = catalogField?.technicalPath;
  return (
    technicalElements.find(
      (element) =>
        element.kind === "field" &&
        (element.id === fieldId || (technicalPath !== undefined && element.path === technicalPath)),
    ) ?? null
  );
}

export function listOfficialInstructions(fieldId: string): OfficialInstruction[] {
  const technical = getTechnicalField(fieldId);
  if (!technical) return [];
  return (semanticRules.rules as OfficialInstruction[])
    .filter(
      (rule) =>
        rule.targetFieldId === technical.id &&
        rule.scope === "official-cross-field-instruction" &&
        Boolean(rule.instruction),
    )
    .map((rule) => ({
      ...rule,
      instruction: normalizeItalianTypography(rule.instruction),
    }));
}

export function listTechnicalEnumerationValues(fieldId: string): string[] {
  const field = getTechnicalField(fieldId);
  return field ? technicalEnumerationValues(field) : [];
}

function mergeFacets(
  inherited: Record<string, string[]>,
  local: Record<string, string[]> | undefined,
): Record<string, string[]> {
  const merged = { ...inherited };
  for (const [name, values] of Object.entries(local ?? {}))
    merged[name] =
      name === "pattern" ? [...new Set([...(merged[name] ?? []), ...values])] : [...values];
  return merged;
}

function combineFacetAlternatives(
  left: Record<string, string[]>[],
  right: Record<string, string[]>[],
): Record<string, string[]>[] {
  return left.flatMap((leftFacets) =>
    right.map((rightFacets) => mergeFacets(leftFacets, rightFacets)),
  );
}

export function getResolvedTechnicalFacetAlternatives(fieldId: string): Record<string, string[]>[] {
  const field = getTechnicalField(fieldId);
  if (!field) return [];
  const typesByName = new Map(technicalTypes.map((type) => [type.name, type]));
  const resolveType = (
    name: string | undefined,
    ancestors = new Set<string>(),
  ): Record<string, string[]>[] => {
    if (!name || ancestors.has(name)) return [{}];
    const type = typesByName.get(name);
    if (!type) return [{}];
    const nextAncestors = new Set(ancestors).add(name);
    let alternatives = resolveType(type.constraints?.base, nextAncestors);
    const members = type.constraints?.unionMemberTypes ?? [];
    if (members.length > 0)
      alternatives = combineFacetAlternatives(
        alternatives,
        members.flatMap((member) => resolveType(member, nextAncestors)),
      );
    return alternatives.map((facets) => mergeFacets(facets, type.constraints?.facets));
  };
  const directMembers = field.constraints.unionMemberTypes ?? [];
  let alternatives =
    directMembers.length > 0
      ? directMembers.flatMap((member) => resolveType(member))
      : resolveType(field.type);
  if (field.constraints.base && field.constraints.base !== field.type)
    alternatives = combineFacetAlternatives(alternatives, resolveType(field.constraints.base));
  return alternatives.map((facets) => mergeFacets(facets, field.constraints.facets));
}

export function getResolvedTechnicalPrimitiveTypes(fieldId: string): string[] {
  const field = getTechnicalField(fieldId);
  if (!field) return [];
  const typesByName = new Map(technicalTypes.map((type) => [type.name, type]));
  const primitives = new Set<string>();
  const visited = new Set<string>();
  const visit = (name: string | undefined) => {
    if (!name || visited.has(name)) return;
    visited.add(name);
    const type = typesByName.get(name);
    if (!type) {
      if (name.startsWith("xs:")) primitives.add(name);
      return;
    }
    visit(type.constraints?.base);
    for (const member of type.constraints?.unionMemberTypes ?? []) visit(member);
  };
  visit(field.type);
  visit(field.constraints.base);
  for (const member of field.constraints.unionMemberTypes ?? []) visit(member);
  return [...primitives];
}

export function getCatalogStatus() {
  const fields = technicalElements.filter((element) => element.kind === "field");
  const mapped = fields.filter(
    (element) =>
      !isSystemManagedTechnicalField(element) &&
      fieldsByPath.get(element.path)?.presentation !== "technical-only",
  ).length;
  const systemManaged = fields.filter(
    (element) =>
      isSystemManagedTechnicalField(element) ||
      fieldsByPath.get(element.path)?.presentation === "technical-only",
  ).length;
  const curatedVisible = fields.filter(
    (element) => fieldsByPath.get(element.path)?.presentation === "visible",
  ).length;
  const unresolvedOverlays = deltaOverlays.overlays.filter((overlay) =>
    String(overlay.state).startsWith("unresolved"),
  );
  const blockers = [
    ...(officialCatalog.blockers ?? []),
    ...(formFields.blockers ?? []),
    ...(semanticRules.blockers ?? []),
    ...(calculationRules.blockers ?? []),
    ...(deltaOverlays.blockers ?? []),
    ...(unresolvedOverlays.length > 0
      ? [`${unresolvedOverlays.length} aggiornamento tecnico ancora irrisolto.`]
      : []),
  ];
  return {
    status:
      mapped + systemManaged === fields.length &&
      semanticRules.rules.length > 0 &&
      calculationRules.rules.length > 0 &&
      unresolvedOverlays.length === 0 &&
      blockers.length === 0 &&
      officialCatalog.releaseEligible
        ? "qualified"
        : "blocked",
    schemaFiles: technicalSchema.coverage.schemaFiles,
    technicalPaths: technicalSchema.coverage.elementPaths,
    technicalFields: fields.length,
    visibleFieldsMapped: mapped,
    systemManagedFields: systemManaged,
    curatedVisibleFields: curatedVisible,
    semanticRules: semanticRules.rules.length,
    calculationRules: calculationRules.rules.length,
    unresolvedOverlays: unresolvedOverlays.length,
    releaseEligible: officialCatalog.releaseEligible,
    blockers: [...new Set(blockers)],
  };
}

export function listQuadroSummaries() {
  return QUADRI.map((id) => {
    const userFields = listQuadroFields(id).filter((field) => field.visibleFieldId !== null);
    return {
      id,
      userFieldCount: userFields.length,
      verifiedFieldCount: userFields.filter((field) => field.mappingKind !== "technical-only")
        .length,
    };
  });
}
