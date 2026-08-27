import technicalSchema from "./technical-schema.json" with { type: "json" };
import formFields from "./form-fields.json" with { type: "json" };
import semanticRules from "./semantic-rules.json" with { type: "json" };
import calculationRules from "./calculation-rules.json" with { type: "json" };
import deltaOverlays from "./delta-overlays.json" with { type: "json" };
import officialCatalog from "./official-catalog.json" with { type: "json" };

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
  entityScope?: "decedent" | "subject" | "asset" | "declaration";
  entryMode?: "editable" | "derived";
  derivedFrom?: string;
  control?: "checkbox";
  appliesToDeclarationKinds?: Array<"first" | "substitute-1" | "substitute-2" | "substitute-3">;
  options?: Array<{ value: string; label: string }>;
  technicalPath: string;
  technicalType: string;
  status: string;
  sourceIds: string[];
}

const technicalElements = (technicalSchema.elements ?? []) as TechnicalElement[];
const technicalTypes = (technicalSchema.types ?? []) as Array<{
  name: string;
  constraints?: {
    base?: string;
    facets?: Record<string, string[]>;
    unionMemberTypes?: string[];
  };
}>;
const fieldsByPath = new Map(
  ((formFields.fields ?? []) as CatalogField[]).map((field) => [field.technicalPath, field]),
);
const fieldsById = new Map(
  ((formFields.fields ?? []) as CatalogField[]).map((field) => [field.id, field]),
);
const visibleFieldOrder = new Map(
  ((formFields.fields ?? []) as CatalogField[]).map((field, index) => [field.id, index]),
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
  return "declaration";
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

function technicalOptions(element: TechnicalElement): Array<{ value: string; label: string }> {
  const values = element.constraints.facets?.enumeration ?? [];
  if (values.length === 0 && element.type.includes("DatoCB_Type"))
    return [
      { value: "0", label: "No" },
      { value: "1", label: "Sì" },
    ];
  return values.map((value) => ({ value, label: value }));
}

function catalogFieldFor(element: TechnicalElement, quadro: QuadroId): CatalogField {
  const curated = fieldsByPath.get(element.path);
  const section = curated?.section ?? fieldSection(element, quadro);
  return {
    id: curated?.id ?? element.id,
    quadro,
    label: curated?.label ?? humanize(element.name),
    page: curated?.page ?? QUADRO_PAGES[quadro],
    visibleNumber: curated?.visibleNumber,
    section,
    saveGroup: curated?.saveGroup ?? section,
    entityScope: curated?.entityScope ?? fieldScope(element, quadro),
    entryMode: curated?.entryMode ?? "editable",
    derivedFrom: curated?.derivedFrom,
    control: curated?.control ?? (element.type.includes("DatoCB_Type") ? "checkbox" : undefined),
    appliesToDeclarationKinds: curated?.appliesToDeclarationKinds ?? [],
    options: curated?.options ?? technicalOptions(element),
    technicalPath: element.path,
    technicalType: element.type,
    status: curated?.status ?? "qualified-from-current-technical-source",
    sourceIds: curated?.sourceIds ?? ["SRC-07", "SRC-08"],
  };
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
    entryMode: NonNullable<CatalogField["entryMode"]>;
    derivedFrom: string | null;
    control: CatalogField["control"] | null;
    appliesToDeclarationKinds: NonNullable<CatalogField["appliesToDeclarationKinds"]>;
    options: Array<{ value: string; label: string }>;
    visibleFieldId: string | null;
    visibleStatus: string;
    sourceIds: string[];
    mappingKind: "curated-visible" | "qualified-technical";
  }
> {
  return technicalElements
    .filter((element) => element.kind === "field" && quadroFromPath(element.path) === quadro)
    .map((element) => {
      const visible = fieldsByPath.get(element.path);
      const field = catalogFieldFor(element, quadro);
      return {
        ...element,
        canonicalId: field.id,
        label: field.label,
        page: field.page ?? null,
        visibleNumber: field.visibleNumber ?? null,
        section: field.section ?? null,
        saveGroup: field.saveGroup ?? null,
        entityScope: field.entityScope ?? "declaration",
        entryMode: field.entryMode ?? "editable",
        derivedFrom: field.derivedFrom ?? null,
        control: field.control ?? null,
        appliesToDeclarationKinds: field.appliesToDeclarationKinds ?? [],
        options: field.options ?? [],
        visibleFieldId: field.id,
        visibleStatus: field.status,
        sourceIds: field.sourceIds,
        mappingKind: visible ? ("curated-visible" as const) : ("qualified-technical" as const),
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
  const curated = fieldsById.get(fieldId);
  if (curated) return curated;
  const element = technicalElements.find(
    (candidate) => candidate.kind === "field" && candidate.id === fieldId,
  );
  const quadro = element ? quadroFromPath(element.path) : null;
  return element && quadro ? catalogFieldFor(element, quadro) : null;
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

export function listTechnicalEnumerationValues(fieldId: string): string[] {
  const field = getTechnicalField(fieldId);
  if (!field) return [];
  const typesByName = new Map(technicalTypes.map((type) => [type.name, type]));
  const values = new Set<string>();
  const visited = new Set<string>();
  const visit = (name: string | undefined) => {
    if (!name || visited.has(name)) return;
    visited.add(name);
    const type = typesByName.get(name);
    if (!type) return;
    for (const value of type.constraints?.facets?.enumeration ?? []) values.add(value);
    visit(type.constraints?.base);
    for (const member of type.constraints?.unionMemberTypes ?? []) visit(member);
  };
  for (const value of field.constraints.facets?.enumeration ?? []) values.add(value);
  visit(field.type);
  visit(field.constraints.base);
  for (const member of field.constraints.unionMemberTypes ?? []) visit(member);
  return [...values];
}

export function getCatalogStatus() {
  const fields = technicalElements.filter((element) => element.kind === "field");
  const mapped = fields.filter((element) => quadroFromPath(element.path) !== null).length;
  const systemManaged = fields.filter(isSystemManagedTechnicalField).length;
  const curatedVisible = fields.filter((element) => fieldsByPath.has(element.path)).length;
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
    const fields = listQuadroFields(id);
    return {
      id,
      technicalFieldCount: fields.length,
      mappedFieldCount: fields.filter((field) => field.mappingKind === "curated-visible").length,
    };
  });
}
