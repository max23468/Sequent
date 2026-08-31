import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { format } from "oxfmt";
import {
  listQuadroFields,
  QUADRI,
  type CatalogField,
  type QuadroId,
} from "../../src/domain/official-catalog/catalog.ts";

const SOURCE_FILE = "XMLConverter_PropertiesREG2013.jar";
const EXPECTED_SHA256 = "e396845477cbc0b7628d75d46782748ec5d1452380e21a59af810ed95709f712";

const PROPERTY_RESOURCE_BY_QUADRO = {
  Frontespizio: "frontespizio",
  EA: "quadroEA",
  EB: "quadroEB",
  EC: "quadroEC",
  ED: "quadroED",
  EE: "quadroEE",
  EF: "quadroEF",
  EG: "quadroEGconAllegati",
  EH: "quadroEH",
  EI: "quadroEINew",
  EL: "quadroEL",
  EM: "quadroEM",
  EN: "quadroEN",
  EO: "quadroEO",
  EP: "quadroEP",
  EQ: "quadroEQ",
  ER: "quadroER",
} as const satisfies Record<QuadroId, string>;

type EntityScope = NonNullable<CatalogField["entityScope"]>;

interface DizImportMapping {
  recordCode: string;
  quadro: QuadroId;
  catalogFieldId: string;
  technicalPath: string;
  entityScope: EntityScope;
  moduleVariant: "first" | "repeated" | "any";
  indexedContainers: Array<{ name: string; index: number }>;
}

interface DizImportMappingsCatalog {
  schemaVersion: 1;
  source: {
    application: "SuccessioniOnLine";
    model: "SUC13";
    softwareVersion: "2.3.1";
    file: typeof SOURCE_FILE;
    sha256: typeof EXPECTED_SHA256;
  };
  counts: {
    catalogFields: number;
    mappedCatalogFields: number;
    mappingAliases: number;
    catalogOnlyFields: number;
    converterOnlyAliases: number;
    ambiguousRecordCodes: number;
  };
  ambiguousRecordCodes: string[];
  catalogOnlyFieldIds: string[];
  converterOnlyMappings: Array<{
    recordCode: string;
    quadro: QuadroId;
    converterPath: string;
    moduleVariant: DizImportMapping["moduleVariant"];
    indexedContainers: DizImportMapping["indexedContainers"];
  }>;
  mappings: DizImportMapping[];
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeRecordCode(value: string): string {
  return value
    .trim()
    .replace(/^#/u, "")
    .replace(/^B0+(?=\d)/u, "B")
    .replace(/^(E[A-S]\d{6})00000001$/u, "$1");
}

function normalizedPath(value: string): string {
  return value
    .replaceAll("\\:", ":")
    .replace(/(?:suc|reg|sc):/gu, "")
    .replace(/\[\d+\]/gu, "")
    .replace(/^\/+|\/+$/gu, "")
    .split("/")
    .filter((part) => part !== "Modulo")
    .join("/");
}

function relativeCatalogPath(technicalPath: string): string {
  return normalizedPath(
    technicalPath.replace(
      /^\/Fornitura\/Dichiarazione\/(?:Frontespizio|Quadro[A-Z]+(?:_new)?)\//u,
      "",
    ),
  );
}

function indexedContainers(path: string): DizImportMapping["indexedContainers"] {
  return path
    .replaceAll("\\:", ":")
    .replace(/(?:suc|reg|sc):/gu, "")
    .split("/")
    .flatMap((part) => {
      const match = /^(.*)\[(\d+)\]$/u.exec(part);
      return match ? [{ name: match[1]!, index: Number.parseInt(match[2]!, 10) }] : [];
    });
}

function moduleVariant(path: string): DizImportMapping["moduleVariant"] {
  const normalized = path.replaceAll("\\:", ":").replace(/(?:suc|reg|sc):/gu, "");
  const outerContainer = normalized.split("/")[0];
  if (outerContainer === "PrimoModulo") return "first";
  if (outerContainer === "Modulo") return "repeated";
  return "any";
}

function resolvedModuleVariant(
  quadro: QuadroId,
  converterPath: string,
  technicalPath: string,
): DizImportMapping["moduleVariant"] {
  const explicit = moduleVariant(converterPath);
  if (
    explicit === "any" &&
    (quadro === "EH" || quadro === "EI") &&
    technicalPath.includes("/Modulo/")
  )
    return "repeated";
  return explicit;
}

function fieldKey(quadro: QuadroId, path: string): string {
  return `${quadro}|${path}`;
}

const CURRENT_EG_SECTION_BY_CONVERTER_SECTION: Record<string, string> = {
  DichiarazioneSostitutiva: "DichSost",
  Testamento: "Testamento",
  Inventario: "Inventario",
  CertificazioneImpostaVersataEstero: "CertificazioneImpostaVersataEstero",
  DocumentiPassivita: "DocumentiPassivita",
  AlberoGenealogico: "AlberoGenealogico",
  DocumentiIdentita: "DocumentiIdentita",
  Altro: "Altro",
  PrimaCasa: "PrimaCasa",
};

function egCatalogPath(converterPath: string): string | null {
  const relative = normalizedPath(converterPath).replace(
    /^Fornitura\/Dichiarazione\/QuadroEG\//u,
    "",
  );
  const parts = relative.split("/");
  const converterSection = parts.find(
    (part) => CURRENT_EG_SECTION_BY_CONVERTER_SECTION[part] !== undefined,
  );
  if (!converterSection) return null;
  const section = CURRENT_EG_SECTION_BY_CONVERTER_SECTION[converterSection]!;
  const leaf = parts.at(-1);
  if (!leaf) return null;
  return parts.at(-2) === "Allegati" ? `${section}/${section}All/${leaf}` : `${section}/${leaf}`;
}

export async function buildDizImportMappings(
  sourcePath: string,
): Promise<DizImportMappingsCatalog> {
  const source = new Uint8Array(await readFile(sourcePath));
  const actualSha256 = sha256(source);
  if (actualSha256 !== EXPECTED_SHA256)
    throw new Error(`Impronta inattesa per ${SOURCE_FILE}: ${actualSha256}`);
  const archive = unzipSync(source);
  const fields = QUADRI.flatMap((quadro) =>
    listQuadroFields(quadro).map((field) => ({ ...field, quadro })),
  );
  const fieldsByPath = new Map(
    fields.map((field) => [fieldKey(field.quadro, relativeCatalogPath(field.path)), field]),
  );
  const mappings: DizImportMapping[] = [];
  const converterOnlyMappings: DizImportMappingsCatalog["converterOnlyMappings"] = [];

  for (const quadro of QUADRI) {
    const resource = archive[`SUC/conf/${PROPERTY_RESOURCE_BY_QUADRO[quadro]}.properties`];
    if (!resource) throw new Error(`Risorsa di conversione assente per ${quadro}.`);
    for (const sourceLine of strFromU8(resource).split(/\r?\n/u)) {
      const line = sourceLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator < 1) continue;
      const sourcePathValue = line.slice(0, separator);
      const field = fieldsByPath.get(
        fieldKey(
          quadro,
          quadro === "EG"
            ? (egCatalogPath(sourcePathValue) ?? normalizedPath(sourcePathValue))
            : normalizedPath(sourcePathValue),
        ),
      );
      if (!field) {
        converterOnlyMappings.push({
          recordCode: normalizeRecordCode(line.slice(separator + 1)),
          quadro,
          converterPath: normalizedPath(sourcePathValue),
          moduleVariant: moduleVariant(sourcePathValue),
          indexedContainers: indexedContainers(sourcePathValue),
        });
        continue;
      }
      mappings.push({
        recordCode: normalizeRecordCode(line.slice(separator + 1)),
        quadro,
        catalogFieldId: field.canonicalId,
        technicalPath: field.path,
        entityScope: field.entityScope ?? "declaration",
        moduleVariant: resolvedModuleVariant(quadro, sourcePathValue, field.path),
        indexedContainers: indexedContainers(sourcePathValue),
      });
    }
  }

  mappings.sort(
    (left, right) =>
      left.recordCode.localeCompare(right.recordCode) ||
      left.technicalPath.localeCompare(right.technicalPath) ||
      JSON.stringify(left.indexedContainers).localeCompare(JSON.stringify(right.indexedContainers)),
  );
  const mappedFieldIds = new Set(mappings.map((mapping) => mapping.catalogFieldId));
  const aliasesByCodeAndVariant = new Map<string, DizImportMapping[]>();
  for (const mapping of mappings) {
    const key = `${mapping.recordCode}|${mapping.moduleVariant}`;
    const aliases = aliasesByCodeAndVariant.get(key) ?? [];
    aliases.push(mapping);
    aliasesByCodeAndVariant.set(key, aliases);
  }
  const ambiguousRecordCodes = [
    ...new Set(
      [...aliasesByCodeAndVariant]
        .filter(([, aliases]) => aliases.length > 1)
        .map(([, aliases]) => aliases[0]!.recordCode),
    ),
  ].sort();
  const catalogOnlyFieldIds = fields
    .filter((field) => !mappedFieldIds.has(field.canonicalId))
    .map((field) => field.canonicalId)
    .sort((left, right) => left.localeCompare(right));
  if (
    fields.length !== 759 ||
    mappedFieldIds.size !== 749 ||
    catalogOnlyFieldIds.length !== 10 ||
    converterOnlyMappings.length !== 215 ||
    ambiguousRecordCodes.length !== 1 ||
    ambiguousRecordCodes[0] !== "EG010E0100000001"
  ) {
    throw new Error(
      `Copertura inattesa: ${mappedFieldIds.size}/${fields.length}, solo catalogo ${catalogOnlyFieldIds.length}, solo convertitore ${converterOnlyMappings.length}.`,
    );
  }
  return {
    schemaVersion: 1,
    source: {
      application: "SuccessioniOnLine",
      model: "SUC13",
      softwareVersion: "2.3.1",
      file: SOURCE_FILE,
      sha256: EXPECTED_SHA256,
    },
    counts: {
      catalogFields: fields.length,
      mappedCatalogFields: mappedFieldIds.size,
      mappingAliases: mappings.length,
      catalogOnlyFields: catalogOnlyFieldIds.length,
      converterOnlyAliases: converterOnlyMappings.length,
      ambiguousRecordCodes: ambiguousRecordCodes.length,
    },
    ambiguousRecordCodes,
    catalogOnlyFieldIds,
    converterOnlyMappings: converterOnlyMappings.sort(
      (left, right) =>
        left.recordCode.localeCompare(right.recordCode) ||
        left.converterPath.localeCompare(right.converterPath),
    ),
    mappings,
  };
}

async function main(): Promise<void> {
  const sourceArgument = process.argv.find((argument) => argument.startsWith("--source="));
  const sourcePath = sourceArgument?.slice("--source=".length);
  if (!sourcePath) throw new Error("Indicare il JAR ufficiale con --source=...");
  const outputPath = resolve(process.cwd(), "src/domain/official-catalog/diz-import-mappings.json");
  const catalog = await buildDizImportMappings(resolve(sourcePath));
  const formatted = await format(outputPath, `${JSON.stringify(catalog, null, 2)}\n`);
  if (formatted.errors.length > 0)
    throw new Error(`Impossibile formattare i mapping: ${formatted.errors[0]?.message}`);
  await writeFile(outputPath, formatted.code, "utf8");
  process.stdout.write(
    `Mapping DIZ di acquisizione aggiornati: ${catalog.counts.mappedCatalogFields}/${catalog.counts.catalogFields} campi, ${catalog.counts.mappingAliases} alias.\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();
