import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { format } from "oxfmt";

const RESOURCE_DIRECTORY = "it/finanze/entrate/sco/resources/" as const;
const RESOURCE_PATHS = {
  municipalityConservatory: `${RESOURCE_DIRECTORY}comuni_conservatorie.res`,
  places: `${RESOURCE_DIRECTORY}SUC_comuni_ccat_13.res`,
  provinceRanges: `${RESOURCE_DIRECTORY}SUC_province_range_13.res`,
  provinces: `${RESOURCE_DIRECTORY}ProvinceAssistenza.res`,
  foreignStates: `${RESOURCE_DIRECTORY}SUC13_nazioni.res`,
  registrationOffices: `${RESOURCE_DIRECTORY}SUC13_codUffReg.res`,
  transcriptionOffices: `${RESOURCE_DIRECTORY}SUC13_codUffTrascrizioni.res`,
  tavolareMunicipalities: `${RESOURCE_DIRECTORY}SUC13_codiceDescComuneTNBZ.res`,
  tavolarePlaces: `${RESOURCE_DIRECTORY}SUC13_comuni_ccat_tavolare.res`,
  cadastralCategories: `${RESOURCE_DIRECTORY}SUC13_CodiciCategoriaNaturaRidotti.res`,
} as const;

interface SourceManifest {
  sources: Array<{
    id: string;
    alias: string;
    version: string;
    sha256: string;
  }>;
}

export interface MunicipalityConservatoryEntry {
  municipalityName: string;
  nationalCode: string;
  cadastralCode: string;
  provinceCode: string;
  conservatoryCode: string | null;
}

export interface OfficialReferenceOption {
  value: string;
  label: string;
}

export interface OfficialPlaceEntry extends OfficialReferenceOption {
  provinceCode: string;
  municipalityCode: string;
  validFrom: string;
  validTo: string;
}

export interface MunicipalityConservatoryCatalog {
  schemaVersion: 1;
  source: {
    sourceId: "SRC-39";
    version: string;
    sha256: string;
    nestedArchive: "lib/controlliXMLREG2013.jar";
    resources: Record<
      keyof typeof RESOURCE_PATHS,
      {
        path: string;
        checksum: string;
        sha256: string;
      }
    >;
  };
  counts: {
    municipalities: number;
    conservatories: number;
    tavolareMunicipalities: number;
    places: number;
    provinces: number;
    foreignStates: number;
    registrationOffices: number;
    transcriptionOffices: number;
    cadastralCategories: number;
    tavolarePlaces: number;
  };
  conservatoryByMunicipalityCode: Record<string, string | null>;
  places: OfficialPlaceEntry[];
  provinces: OfficialReferenceOption[];
  foreignStates: OfficialReferenceOption[];
  registrationOffices: OfficialReferenceOption[];
  transcriptionOffices: OfficialReferenceOption[];
  tavolareMunicipalities: OfficialReferenceOption[];
  tavolarePlaces: OfficialPlaceEntry[];
  cadastralCategories: OfficialReferenceOption[];
}

function sha256(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

function resourceLines(
  resource: Uint8Array,
  name: string,
): {
  checksum: string;
  lines: string[];
} {
  const lines = strFromU8(resource).split(/\r?\n/u);
  const checksum = lines.shift()?.trimEnd();
  if (!checksum?.startsWith("#") || checksum.length === 1)
    throw new Error(`Intestazione di integrità non valida per ${name}.`);
  return {
    checksum: checksum.slice(1).trim(),
    lines: lines.filter((line) => line.trim() !== ""),
  };
}

function parseKeyValueOptions(lines: string[], name: string): OfficialReferenceOption[] {
  return lines.map((line, index) => {
    const separator = line.indexOf("=");
    if (separator < 1) throw new Error(`Riga ${index + 2} non valida per ${name}.`);
    const value = line.slice(0, separator).trim();
    const label = line
      .slice(separator + 1)
      .trim()
      .replace(/\s+/gu, " ");
    if (!value || !label) throw new Error(`Riga ${index + 2} incompleta per ${name}.`);
    return { value, label };
  });
}

function parsePlaceDate(value: string, name: string, index: number): string {
  const normalized = value.trim();
  if (!/^\d{8}$/u.test(normalized))
    throw new Error(`Data non valida alla riga ${index + 2} di ${name}.`);
  return `${normalized.slice(4, 8)}-${normalized.slice(2, 4)}-${normalized.slice(0, 2)}`;
}

function parsePlaces(placeLines: string[], rangeLines: string[]): OfficialPlaceEntry[] {
  const provinceByIndex = new Map<number, string>();
  for (const [index, line] of rangeLines.entries()) {
    const match = line.match(/^([^=]+)=(\d+),(\d+)\*-?\d+$/u);
    if (!match) throw new Error(`Intervallo provinciale non valido alla riga ${index + 2}.`);
    const [, provinceCode, startValue, endValue] = match;
    const start = Number(startValue);
    const end = Number(endValue);
    for (let placeIndex = start; placeIndex <= end; placeIndex += 1) {
      if (provinceByIndex.has(placeIndex))
        throw new Error(`Indice ${placeIndex} presente in più intervalli provinciali.`);
      provinceByIndex.set(placeIndex, provinceCode!);
    }
  }
  return placeLines.map((line, index) => {
    const [label, municipalityCode, , validFrom, validTo] = line.split("*");
    const provinceCode = provinceByIndex.get(index);
    if (!label || !municipalityCode || !validFrom || !validTo || !provinceCode)
      throw new Error(`Riga ${index + 2} dell’archivio Comuni e Stati incompleta.`);
    return {
      value: label.trim().replace(/\s+/gu, " "),
      label: label.trim().replace(/\s+/gu, " "),
      provinceCode,
      municipalityCode,
      validFrom: parsePlaceDate(validFrom, "archivio Comuni e Stati", index),
      validTo: parsePlaceDate(validTo, "archivio Comuni e Stati", index),
    };
  });
}

function parseTavolarePlaces(lines: string[], places: OfficialPlaceEntry[]): OfficialPlaceEntry[] {
  const provinceByMunicipalityCode = new Map(
    places
      .filter((place) => place.provinceCode !== "EE")
      .map((place) => [place.municipalityCode, place.provinceCode]),
  );
  return lines.map((line, index) => {
    const [label, municipalityCode, , validFrom, validTo] = line.split("*");
    if (!label || !municipalityCode || !validFrom || !validTo)
      throw new Error(`Riga ${index + 2} dell’archivio tavolare incompleta.`);
    return {
      value: label.trim().replace(/\s+/gu, " "),
      label: label.trim().replace(/\s+/gu, " "),
      provinceCode: provinceByMunicipalityCode.get(municipalityCode) ?? "",
      municipalityCode,
      validFrom: parsePlaceDate(validFrom, "archivio tavolare", index),
      validTo: parsePlaceDate(validTo, "archivio tavolare", index),
    };
  });
}

export async function buildMunicipalityConservatoryCatalog(
  repositoryRoot = process.cwd(),
): Promise<MunicipalityConservatoryCatalog> {
  const manifest = JSON.parse(
    await readFile(
      resolve(repositoryRoot, "src/domain/official-catalog/source-manifest.json"),
      "utf8",
    ),
  ) as SourceManifest;
  const source = manifest.sources.find((candidate) => candidate.id === "SRC-39");
  if (!source) throw new Error("Fonte SRC-39 assente dal manifest.");

  const plugin = new Uint8Array(
    await readFile(resolve(repositoryRoot, "private/official-sources", source.alias)),
  );
  if (sha256(plugin) !== source.sha256)
    throw new Error("Impronta della fonte SRC-39 diversa dal manifest canonico.");

  const pluginArchive = unzipSync(plugin);
  const nestedJar = pluginArchive["lib/controlliXMLREG2013.jar"];
  if (!nestedJar) throw new Error("Archivio controlliXMLREG2013.jar assente da SRC-39.");
  const controlArchive = unzipSync(nestedJar);
  const resources = Object.fromEntries(
    Object.entries(RESOURCE_PATHS).map(([name, path]) => {
      const resource = controlArchive[path];
      if (!resource) throw new Error(`Risorsa ${path} assente da SRC-39.`);
      const parsed = resourceLines(resource, name);
      return [name, { content: resource, ...parsed }];
    }),
  ) as Record<
    keyof typeof RESOURCE_PATHS,
    {
      content: Uint8Array;
      checksum: string;
      lines: string[];
    }
  >;

  const municipalities = resources.municipalityConservatory.lines
    .map((line, index): MunicipalityConservatoryEntry => {
      const parts = line.split("*");
      if (parts.length !== 5)
        throw new Error(`Riga ${index + 2} della mappa Comune-conservatoria non valida.`);
      const [municipalityName, nationalCode, cadastralCode, provinceCode, conservatoryCode] = parts;
      if (!municipalityName || !nationalCode || !provinceCode || !conservatoryCode)
        throw new Error(`Riga ${index + 2} della mappa Comune-conservatoria incompleta.`);
      if (!/^[A-Z]\d{3}(?:[AB])?$/u.test(nationalCode))
        throw new Error(`Codice nazionale non valido alla riga ${index + 2}: ${nationalCode}`);
      return {
        municipalityName,
        nationalCode,
        cadastralCode: cadastralCode ?? "",
        provinceCode,
        conservatoryCode: conservatoryCode === "-" ? null : conservatoryCode,
      };
    })
    .sort((left, right) =>
      left.nationalCode < right.nationalCode ? -1 : left.nationalCode > right.nationalCode ? 1 : 0,
    );

  const distinctCodes = new Set(municipalities.map(({ nationalCode }) => nationalCode));
  if (distinctCodes.size !== municipalities.length)
    throw new Error("La mappa Comune-conservatoria contiene codici nazionali duplicati.");

  const conservatories = new Set(
    municipalities.flatMap(({ conservatoryCode }) =>
      conservatoryCode === null ? [] : [conservatoryCode],
    ),
  );
  const conservatoryByMunicipalityCode = Object.fromEntries(
    municipalities.map(({ nationalCode, conservatoryCode }) => [nationalCode, conservatoryCode]),
  );
  const places = parsePlaces(resources.places.lines, resources.provinceRanges.lines);
  const provinces = parseKeyValueOptions(resources.provinces.lines, "province").map((option) => ({
    ...option,
    label: option.label.replace(new RegExp(`^${option.value}\\s+`, "u"), ""),
  }));
  const foreignStates = parseKeyValueOptions(resources.foreignStates.lines, "Stati esteri");
  const registrationOffices = parseKeyValueOptions(
    resources.registrationOffices.lines,
    "uffici di registrazione",
  );
  const transcriptionOffices = parseKeyValueOptions(
    resources.transcriptionOffices.lines,
    "uffici di trascrizione",
  );
  const tavolareMunicipalities = parseKeyValueOptions(
    resources.tavolareMunicipalities.lines,
    "Comuni catastali tavolari",
  );
  const tavolarePlaces = parseTavolarePlaces(resources.tavolarePlaces.lines, places);
  const cadastralCategories = parseKeyValueOptions(
    resources.cadastralCategories.lines,
    "categorie catastali",
  );
  return {
    schemaVersion: 1,
    source: {
      sourceId: "SRC-39",
      version: source.version,
      sha256: source.sha256,
      nestedArchive: "lib/controlliXMLREG2013.jar",
      resources: Object.fromEntries(
        (
          Object.entries(RESOURCE_PATHS) as Array<
            [keyof typeof RESOURCE_PATHS, (typeof RESOURCE_PATHS)[keyof typeof RESOURCE_PATHS]]
          >
        ).map(([name, path]) => [
          name,
          {
            path,
            checksum: resources[name].checksum,
            sha256: sha256(resources[name].content),
          },
        ]),
      ) as MunicipalityConservatoryCatalog["source"]["resources"],
    },
    counts: {
      municipalities: municipalities.length,
      conservatories: conservatories.size,
      tavolareMunicipalities: municipalities.filter(
        ({ conservatoryCode }) => conservatoryCode === null,
      ).length,
      places: places.length,
      provinces: provinces.length,
      foreignStates: foreignStates.length,
      registrationOffices: registrationOffices.length,
      transcriptionOffices: transcriptionOffices.length,
      cadastralCategories: cadastralCategories.length,
      tavolarePlaces: tavolarePlaces.length,
    },
    conservatoryByMunicipalityCode,
    places,
    provinces,
    foreignStates,
    registrationOffices,
    transcriptionOffices,
    tavolareMunicipalities,
    tavolarePlaces,
    cadastralCategories,
  };
}

async function main(): Promise<void> {
  const repositoryRoot = process.cwd();
  const outputPath = resolve(
    repositoryRoot,
    "src/domain/official-catalog/municipality-conservatory-map.json",
  );
  const catalog = await buildMunicipalityConservatoryCatalog(repositoryRoot);
  const formatted = await format(outputPath, `${JSON.stringify(catalog, null, 2)}\n`);
  if (formatted.errors.length > 0)
    throw new Error(`Impossibile formattare la mappa: ${formatted.errors[0]?.message}`);
  await writeFile(outputPath, formatted.code, "utf8");
  console.log(
    `Catalogo territoriale aggiornato: ${catalog.counts.places} località e Stati storicizzati, ${catalog.counts.municipalities} comuni correnti, ${catalog.counts.registrationOffices} uffici di registrazione.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();
