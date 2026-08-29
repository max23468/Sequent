import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { format } from "oxfmt";

const RESOURCE_PATH = "it/finanze/entrate/sco/resources/comuni_conservatorie.res" as const;

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

export interface MunicipalityConservatoryCatalog {
  schemaVersion: 1;
  source: {
    sourceId: "SRC-39";
    version: string;
    sha256: string;
    nestedArchive: "lib/controlliXMLREG2013.jar";
    resourcePath: typeof RESOURCE_PATH;
    resourceChecksum: string;
    resourceSha256: string;
  };
  counts: {
    municipalities: number;
    conservatories: number;
    tavolareMunicipalities: number;
  };
  conservatoryByMunicipalityCode: Record<string, string | null>;
}

function sha256(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
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
  const resource = controlArchive[RESOURCE_PATH];
  if (!resource) throw new Error(`Risorsa ${RESOURCE_PATH} assente da SRC-39.`);

  const lines = strFromU8(resource).split(/\r?\n/u);
  const checksum = lines.shift();
  if (!checksum?.startsWith("#") || checksum.length === 1)
    throw new Error("Intestazione di integrità della mappa Comune-conservatoria non valida.");

  const municipalities = lines
    .filter((line) => line !== "")
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
  return {
    schemaVersion: 1,
    source: {
      sourceId: "SRC-39",
      version: source.version,
      sha256: source.sha256,
      nestedArchive: "lib/controlliXMLREG2013.jar",
      resourcePath: RESOURCE_PATH,
      resourceChecksum: checksum.slice(1),
      resourceSha256: sha256(resource),
    },
    counts: {
      municipalities: municipalities.length,
      conservatories: conservatories.size,
      tavolareMunicipalities: municipalities.filter(
        ({ conservatoryCode }) => conservatoryCode === null,
      ).length,
    },
    conservatoryByMunicipalityCode,
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
    `Mappa Comune-conservatoria aggiornata: ${catalog.counts.municipalities} comuni, ${catalog.counts.conservatories} conservatorie, ${catalog.counts.tavolareMunicipalities} comuni tavolari.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();
