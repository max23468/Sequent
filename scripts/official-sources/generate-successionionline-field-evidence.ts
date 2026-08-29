import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { format } from "oxfmt";
import {
  buildOperationalParityMap,
  requiresOfficialApplicationEvidence,
} from "../../src/domain/operational-parity.ts";
import { listQuadroFields } from "../../src/domain/official-catalog/catalog.ts";

const EXPECTED_SOURCES = {
  "SUC13_ResSUC13.jar": "2332c71fb3f6db61ed7fe68e7f2f56c18e85015c96aea3c7df905d58dfaf24b5",
  "XMLConverter_PropertiesREG2013.jar":
    "e396845477cbc0b7628d75d46782748ec5d1452380e21a59af810ed95709f712",
} as const;

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
} as const;

type ReviewedProducer = "professionista" | "automatico" | "riservato-ufficio";

interface FieldEvidence {
  fieldId: string;
  recordCode: string;
  uiControls: string[];
  reviewedProducer: ReviewedProducer;
  producerBasis:
    | "controllo-input-diretto"
    | "flusso-professionale-wizard-o-specializzato"
    | "calcolo-ufficiale"
    | "identificativo-generato-dal-software"
    | "sezione-riservata-all-ufficio";
}

interface OfficialApplicationEvidence {
  schemaVersion: 1;
  application: {
    name: "SuccessioniOnLine";
    model: "SUC13";
    jnlpUrl: "https://jws.agenziaentrate.it/jws/registro/2013/SUC13/SUC13.jnlp";
    sources: Array<{ file: string; sha256: string }>;
  };
  counts: Record<ReviewedProducer, number> & { reviewedFields: number };
  fields: FieldEvidence[];
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

function normalizeTechnicalPath(value: string): string {
  return value
    .replaceAll("\\:", ":")
    .replace(/(?:suc|reg|sc):/gu, "")
    .replace(/\[\d+\]/gu, "")
    .replace(/^\/+|\/+$/gu, "")
    .split("/")
    .filter((part) => part !== "Modulo")
    .join("/");
}

function relativeFieldPath(technicalPath: string): string {
  return normalizeTechnicalPath(
    technicalPath.replace(
      /^\/Fornitura\/Dichiarazione\/(?:Frontespizio|Quadro[A-Z]+(?:_new)?)\//u,
      "",
    ),
  );
}

function producerFor(row: ReturnType<typeof buildOperationalParityMap>[number]): {
  reviewedProducer: ReviewedProducer;
  producerBasis: FieldEvidence["producerBasis"];
} {
  if (row.technicalPath.endsWith("/IdentificativoProdSoftware"))
    return {
      reviewedProducer: "automatico",
      producerBasis: "identificativo-generato-dal-software",
    };
  if (row.technicalPath.includes("/CampiServizio/") || row.technicalPath.includes("/F24/"))
    return {
      reviewedProducer: "riservato-ufficio",
      producerBasis: "sezione-riservata-all-ufficio",
    };
  if (
    row.technicalPath.includes("/FirmaModello/Casella") ||
    row.technicalPath.endsWith("/Frontespizio/ImportoDaVersare") ||
    row.technicalPath.endsWith("/QuadroEF/SezioneVBis_ImpostaSuccessione/ImpostaCalcolata/Imposta")
  )
    return { reviewedProducer: "automatico", producerBasis: "calcolo-ufficiale" };
  return {
    reviewedProducer: "professionista",
    producerBasis: "flusso-professionale-wizard-o-specializzato",
  };
}

function parsePropertyMappings(archive: Record<string, Uint8Array>): Map<string, string> {
  const result = new Map<string, string>();
  for (const [quadro, resourceName] of Object.entries(PROPERTY_RESOURCE_BY_QUADRO)) {
    const resource = archive[`SUC/conf/${resourceName}.properties`];
    if (!resource) throw new Error(`Risorsa di conversione assente per ${quadro}.`);
    for (const sourceLine of strFromU8(resource).split(/\r?\n/u)) {
      const line = sourceLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator < 1) continue;
      result.set(
        `${quadro}|${normalizeTechnicalPath(line.slice(0, separator))}`,
        normalizeRecordCode(line.slice(separator + 1)),
      );
    }
  }
  return result;
}

function parseUiControls(archive: Record<string, Uint8Array>): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  const scriptPrefix = "finanze/IDAC/resources/SUC13/localAppRoot/script/";
  for (const [resourcePath, resource] of Object.entries(archive)) {
    if (!resourcePath.startsWith(scriptPrefix) || !resourcePath.endsWith(".txt")) continue;
    for (const sourceLine of strFromU8(resource).split(/\r?\n/u)) {
      const line = sourceLine.trim();
      if (!line || line.startsWith("//")) continue;
      const match = line.match(/^([A-Za-z][A-Za-z0-9_]*)\s*\(([^)]*)\)/u);
      if (!match) continue;
      const [first = "", second = ""] = match[2]?.split(";").map((part) => part.trim()) ?? [];
      const rawCode = match[1] === "SingleRadioGroup" ? second : first;
      const code = normalizeRecordCode(rawCode);
      if (!/^(?:B|E[A-S])\d+/u.test(code)) continue;
      const controls = result.get(code) ?? new Set<string>();
      controls.add(match[1]!);
      result.set(code, controls);
    }
  }
  return result;
}

export async function buildOfficialApplicationEvidence(
  sourceDirectory: string,
): Promise<OfficialApplicationEvidence> {
  const sourceEntries = await Promise.all(
    Object.entries(EXPECTED_SOURCES).map(async ([file, expectedSha256]) => {
      const content = new Uint8Array(await readFile(resolve(sourceDirectory, file)));
      const actualSha256 = sha256(content);
      if (actualSha256 !== expectedSha256)
        throw new Error(`Impronta inattesa per ${file}: ${actualSha256}`);
      return { file, sha256: actualSha256, content };
    }),
  );
  const propertyArchive = unzipSync(
    sourceEntries.find(({ file }) => file === "XMLConverter_PropertiesREG2013.jar")!.content,
  );
  const resourceArchive = unzipSync(
    sourceEntries.find(({ file }) => file === "SUC13_ResSUC13.jar")!.content,
  );
  const recordCodeByPath = parsePropertyMappings(propertyArchive);
  const controlsByCode = parseUiControls(resourceArchive);
  const rows = buildOperationalParityMap().filter((row) => {
    const field = listQuadroFields(row.quadro).find(
      (candidate) => candidate.canonicalId === row.fieldId,
    );
    return field ? requiresOfficialApplicationEvidence(row.quadro, field) : false;
  });
  if (rows.length !== 257)
    throw new Error(`Attesi 257 campi da riesaminare, trovati ${rows.length}.`);

  const fields = rows
    .map((row): FieldEvidence => {
      const recordCode = recordCodeByPath.get(
        `${row.quadro}|${relativeFieldPath(row.technicalPath)}`,
      );
      if (!recordCode) throw new Error(`Codice record non trovato per ${row.fieldId}.`);
      const producer = producerFor(row);
      const uiControls = [...(controlsByCode.get(recordCode) ?? [])].sort();
      return {
        fieldId: row.fieldId,
        recordCode,
        uiControls,
        ...producer,
        producerBasis:
          producer.reviewedProducer === "professionista" &&
          uiControls.some((control) =>
            [
              "CampoData",
              "CampoInput",
              "CFAnagrafica",
              "CheckPannello",
              "ComboInput",
              "RadioPannello",
              "SingleRadio",
              "SingleRadioGroup",
            ].includes(control),
          )
            ? "controllo-input-diretto"
            : producer.producerBasis,
      };
    })
    .sort((left, right) => left.fieldId.localeCompare(right.fieldId, "it"));

  const count = (producer: ReviewedProducer) =>
    fields.filter((field) => field.reviewedProducer === producer).length;
  const counts = {
    reviewedFields: fields.length,
    professionista: count("professionista"),
    automatico: count("automatico"),
    "riservato-ufficio": count("riservato-ufficio"),
  };
  if (
    counts.professionista !== 230 ||
    counts.automatico !== 19 ||
    counts["riservato-ufficio"] !== 8
  )
    throw new Error(`Conteggi produttori inattesi: ${JSON.stringify(counts)}`);

  return {
    schemaVersion: 1,
    application: {
      name: "SuccessioniOnLine",
      model: "SUC13",
      jnlpUrl: "https://jws.agenziaentrate.it/jws/registro/2013/SUC13/SUC13.jnlp",
      sources: sourceEntries.map(({ file, sha256: sourceSha256 }) => ({
        file: basename(file),
        sha256: sourceSha256,
      })),
    },
    counts,
    fields,
  };
}

async function main(): Promise<void> {
  const sourceArgument = process.argv.find((argument) => argument.startsWith("--source-dir="));
  const sourceDirectory =
    sourceArgument?.slice("--source-dir=".length) ?? process.env.SUC13_OFFICIAL_APP_DIR;
  if (!sourceDirectory)
    throw new Error(
      "Indicare la cartella dei JAR ufficiali con --source-dir=... o SUC13_OFFICIAL_APP_DIR.",
    );
  const outputPath = resolve(
    process.cwd(),
    "src/domain/official-catalog/successionionline-field-evidence.json",
  );
  const evidence = await buildOfficialApplicationEvidence(sourceDirectory);
  const formatted = await format(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  if (formatted.errors.length > 0)
    throw new Error(`Impossibile formattare l’evidenza: ${formatted.errors[0]?.message}`);
  await writeFile(outputPath, formatted.code, "utf8");
  console.log(
    `Evidenza SuccessioniOnLine aggiornata: ${evidence.counts.reviewedFields} campi (${evidence.counts.professionista} professionali, ${evidence.counts.automatico} automatici, ${evidence.counts["riservato-ufficio"]} riservati all’ufficio).`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();
