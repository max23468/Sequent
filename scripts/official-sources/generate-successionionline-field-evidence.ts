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
import { normalizeItalianTypography } from "../../src/domain/italian-typography.ts";

const EXPECTED_SOURCES = {
  "SUC13.jar": "f7d01561591634ecb450c08e00cef5f91fb63810a28bf4cb25d14bed378bd2d1",
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

const SOURCE_QUALIFIED_OVERRIDES = new Set([
  "xsd:/Fornitura/Dichiarazione/QuadroEF/SezioneI_ImpostaIpotecaria/ImpostaIpotecariaVersata",
  "xsd:/Fornitura/Dichiarazione/QuadroEF/SezioneII_ImpostaCatastale/ImpostaCatastaleVersata",
]);

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

interface LayoutEvidence {
  fieldId: string;
  quadro: string;
  recordCode: string;
  script: string;
  section: string;
  page: number;
  order: number;
  uiControls: string[];
  radioGroup: string | null;
}

interface AttachmentBucketEvidence {
  id: `EG${number}`;
  recordCode: string;
  fieldId?: string;
  converterPath?: string;
  sourcePointer?: string;
  label: string;
  order: number;
}

interface ConditionalRuleEvidence {
  triggerRecordCode: string;
  triggerValue: "1";
  effect: "disable-while-selected";
  targetRecordCodes: string[];
  sourcePointer: string;
}

interface ScreenCommandEvidence {
  quadro: string;
  script: string;
  page: number;
  section: string;
  order: number;
  command: string;
  recordCodes: string[];
  arguments: string[];
  sourcePointer: string;
}

interface OfficialApplicationEvidence {
  schemaVersion: 5;
  application: {
    name: "SuccessioniOnLine";
    model: "SUC13";
    jnlpUrl: "https://jws.agenziaentrate.it/jws/registro/2013/SUC13/SUC13.jnlp";
    sources: Array<{ file: string; sha256: string }>;
  };
  counts: Record<ReviewedProducer, number> & {
    reviewedFields: number;
    layoutFields: number;
    attachmentBuckets: number;
    conditionalRules: number;
    screenCommands: number;
  };
  fields: FieldEvidence[];
  layout: LayoutEvidence[];
  attachmentBuckets: AttachmentBucketEvidence[];
  conditionalRules: ConditionalRuleEvidence[];
  screenModel: {
    schemaVersion: 1;
    file: "successionionline-screen-commands.json";
  };
}

interface OfficialApplicationEvidenceBundle {
  evidence: OfficialApplicationEvidence;
  screenCommands: ScreenCommandEvidence[];
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

function normalizeUiSection(value: string): string {
  const numbered = value.match(/^SEZIONE ([IVX]+): (.*)$/u);
  if (numbered)
    return normalizeItalianTypography(`Sezione ${numbered[1]}: ${numbered[2]}`).replaceAll(
      "'",
      "’",
    );
  const [heading, suffix] = value.split(" - ", 2);
  const normalizedHeading = heading?.toLocaleLowerCase("it") ?? value;
  const sentenceHeading = `${normalizedHeading.charAt(0).toLocaleUpperCase("it")}${normalizedHeading.slice(1)}`;
  return normalizeItalianTypography(
    suffix ? `${sentenceHeading} — ${suffix}` : sentenceHeading,
  ).replaceAll("'", "’");
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

function parseAggregateEgCountMappings(
  archive: Record<string, Uint8Array>,
): Map<string, { converterPath: string; sourcePointer: string }> {
  const resourcePath = "SUC/conf/quadroEG.properties";
  const resource = archive[resourcePath];
  if (!resource) throw new Error("Risorsa aggregata di conversione EG assente.");
  const result = new Map<string, { converterPath: string; sourcePointer: string }>();
  for (const sourceLine of strFromU8(resource).split(/\r?\n/u)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const converterPath = normalizeTechnicalPath(line.slice(0, separator));
    if (!converterPath.endsWith("Num")) continue;
    const recordCode = normalizeRecordCode(line.slice(separator + 1));
    if (result.has(recordCode))
      throw new Error(`Codice aggregato EG duplicato nella conversione: ${recordCode}.`);
    result.set(recordCode, {
      converterPath,
      sourcePointer: `XMLConverter_PropertiesREG2013.jar#${resourcePath}:${converterPath}`,
    });
  }
  if (result.size !== 11)
    throw new Error(`Attesi 11 contatori aggregati EG, trovati ${result.size}.`);
  return result;
}

function parseUiControls(archive: Record<string, Uint8Array>): {
  controlsByCode: Map<string, Set<string>>;
  layoutByQuadroAndCode: Map<
    string,
    { script: string; section: string; page: number; order: number }
  >;
  radioGroupByQuadroAndCode: Map<string, string>;
  attachmentBuckets: AttachmentBucketEvidence[];
  screenCommands: ScreenCommandEvidence[];
} {
  const controlsByCode = new Map<string, Set<string>>();
  const layoutByQuadroAndCode = new Map<
    string,
    { script: string; section: string; page: number; order: number }
  >();
  const radioGroupByQuadroAndCode = new Map<string, string>();
  const attachmentBuckets: AttachmentBucketEvidence[] = [];
  const screenCommands: ScreenCommandEvidence[] = [];
  const scriptPrefix = "finanze/IDAC/resources/SUC13/localAppRoot/script/";
  const quadroByScript = new Map([
    ["DatiAnagrafici", "Frontespizio"],
    ...Object.keys(PROPERTY_RESOURCE_BY_QUADRO)
      .filter((quadro) => quadro !== "Frontespizio")
      .map((quadro) => [quadro, quadro] as const),
  ]);
  for (const [resourcePath, resource] of Object.entries(archive).sort(([left], [right]) =>
    left.localeCompare(right, "it"),
  )) {
    if (!resourcePath.startsWith(scriptPrefix) || !resourcePath.endsWith(".txt")) continue;
    const script = basename(resourcePath, ".txt");
    const quadro = quadroByScript.get(script);
    let order = 0;
    let screenOrder = 0;
    let page = 1;
    let section = quadro === "Frontespizio" ? "Dati generali" : `Quadro ${quadro}`;
    let currentRadioGroup: string | null = null;
    let radioGroupIndex = 0;
    let pendingAttachmentBucket: Omit<AttachmentBucketEvidence, "recordCode" | "order"> | null =
      null;
    for (const [lineIndex, sourceLine] of strFromU8(resource).split(/\r?\n/u).entries()) {
      const line = sourceLine.trim();
      if (!line || line.startsWith("//")) continue;
      const sectionMatch = line.match(/^SeparaSezione\(([^;]*);[^;]*;negativo\)/u);
      if (sectionMatch?.[1]?.trim()) {
        const rawSection = sectionMatch[1].trim();
        section = normalizeUiSection(rawSection);
      }
      const match = line.match(/^([A-Za-z][A-Za-z0-9_]*)\s*\(([^)]*)\)/u);
      if (!match) continue;
      const closingParenthesis = line.lastIndexOf(")");
      const openingParenthesis = line.indexOf("(");
      if (closingParenthesis < openingParenthesis)
        throw new Error(`Comando schermata non terminato in ${resourcePath}:${lineIndex + 1}.`);
      const argumentsList = line
        .slice(openingParenthesis + 1, closingParenthesis)
        .split(";")
        .map((part) => part.trim());
      const [first = "", second = ""] = argumentsList;
      if (quadro && !["Accapo", "Vuoto"].includes(match[1]!)) {
        screenCommands.push({
          quadro,
          script,
          page,
          section,
          order: screenOrder,
          command: match[1]!,
          recordCodes: [
            ...new Set(
              argumentsList.flatMap((argument) =>
                [...argument.matchAll(/#?(?:B|E[A-S])[0-9A-Z]{6,14}/gu)].map((codeMatch) =>
                  normalizeRecordCode(codeMatch[0]),
                ),
              ),
            ),
          ],
          arguments: argumentsList,
          sourcePointer: `SUC13_ResSUC13.jar#${resourcePath}:${lineIndex + 1}`,
        });
        screenOrder += 1;
      }
      const attachmentLabel =
        quadro === "EG" && match[1] === "Etichetta" ? first.match(/^EG(\d+) - (.+)$/u) : null;
      if (attachmentLabel)
        pendingAttachmentBucket = {
          id: `EG${Number(attachmentLabel[1])}`,
          label: normalizeItalianTypography(attachmentLabel[2]!).replaceAll("'", "’"),
        };
      if (quadro === "EG" && match[1] === "ListaFileSemaforo") {
        if (!pendingAttachmentBucket)
          throw new Error(`Contenitore allegati senza etichetta per ${first}.`);
        attachmentBuckets.push({
          ...pendingAttachmentBucket,
          recordCode: normalizeRecordCode(first),
          order: attachmentBuckets.length,
        });
        pendingAttachmentBucket = null;
      }
      if (match[1] === "NextPage") {
        page += 1;
        continue;
      }
      if (match[1] === "NewRadioGroup") {
        currentRadioGroup = `${script}:radio-${radioGroupIndex}`;
        radioGroupIndex += 1;
        continue;
      }
      if (match[1] === "NewRadioMultiGroup") {
        currentRadioGroup = first ? `${script}:radio-${first}` : null;
        continue;
      }
      const rawCode = match[1] === "SingleRadioGroup" ? second : first;
      const code = normalizeRecordCode(rawCode);
      if (!/^(?:B|E[A-S])\d+/u.test(code)) continue;
      const controls = controlsByCode.get(code) ?? new Set<string>();
      controls.add(match[1]!);
      controlsByCode.set(code, controls);
      if (quadro) {
        const key = `${quadro}|${code}`;
        if (!layoutByQuadroAndCode.has(key))
          layoutByQuadroAndCode.set(key, { script, section, page, order });
        const radioGroup =
          match[1] === "SingleRadioGroup"
            ? first
              ? `${script}:radio-${first}`
              : null
            : match[1] === "SingleRadio"
              ? currentRadioGroup
              : null;
        if (radioGroup) {
          const existingRadioGroup = radioGroupByQuadroAndCode.get(key);
          if (existingRadioGroup && existingRadioGroup !== radioGroup)
            throw new Error(`Gruppi radio discordanti per ${key}.`);
          radioGroupByQuadroAndCode.set(key, radioGroup);
        }
        order += 1;
      }
    }
  }
  return {
    controlsByCode,
    layoutByQuadroAndCode,
    radioGroupByQuadroAndCode,
    attachmentBuckets,
    screenCommands,
  };
}

function officialConditionalRules(): ConditionalRuleEvidence[] {
  const sourcePointer =
    "SUC13.jar#it.finanze.entrate.sco.quadri.EventiQuadroEH.eventiCampi/eventiTestamento";
  return [
    {
      triggerRecordCode: "EH000014",
      triggerValue: "1",
      effect: "disable-while-selected",
      targetRecordCodes: ["EH000015", "EH000019", "EH000020", "EH000077"],
      sourcePointer,
    },
    {
      triggerRecordCode: "EH000018",
      triggerValue: "1",
      effect: "disable-while-selected",
      targetRecordCodes: ["EH000015", "EH000016", "EH000017"],
      sourcePointer,
    },
    {
      triggerRecordCode: "EH000021",
      triggerValue: "1",
      effect: "disable-while-selected",
      targetRecordCodes: [
        "EH004001",
        "EH004002",
        "EH004003",
        "EH004004",
        "EH004005",
        "EH005001",
        "EH005002",
        "EH005003",
        "EH005004",
        "EH005005",
      ],
      sourcePointer,
    },
    {
      triggerRecordCode: "EH000023",
      triggerValue: "1",
      effect: "disable-while-selected",
      targetRecordCodes: ["EH007001", "EH007002", "EH007003"],
      sourcePointer,
    },
    {
      triggerRecordCode: "EH000025",
      triggerValue: "1",
      effect: "disable-while-selected",
      targetRecordCodes: [
        "EH008001",
        "EH008002",
        "EH008003",
        "EH008004",
        "EH008005",
        "EH008006",
        "EH008007",
      ],
      sourcePointer,
    },
  ];
}

export async function buildOfficialApplicationEvidence(
  sourceDirectory: string,
): Promise<OfficialApplicationEvidenceBundle> {
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
  const aggregateEgCountMappings = parseAggregateEgCountMappings(propertyArchive);
  const {
    controlsByCode,
    layoutByQuadroAndCode,
    radioGroupByQuadroAndCode,
    attachmentBuckets,
    screenCommands,
  } = parseUiControls(resourceArchive);
  const conditionalRules = officialConditionalRules();
  if (attachmentBuckets.length !== 11)
    throw new Error(`Attesi 11 contenitori allegati EG, trovati ${attachmentBuckets.length}.`);
  const parityRows = buildOperationalParityMap();
  const egCountFields = listQuadroFields("EG").filter((field) => field.visibleFieldId !== null);
  if (egCountFields.length !== attachmentBuckets.length)
    throw new Error(
      `I ${attachmentBuckets.length} contenitori EG non coincidono con i ${egCountFields.length} contatori ufficiali.`,
    );
  const qualifiedAttachmentBuckets = attachmentBuckets.map((bucket) => {
    const aggregateMapping = aggregateEgCountMappings.get(bucket.recordCode);
    if (!aggregateMapping)
      throw new Error(`Contenitore ${bucket.id} senza mapping aggregato ${bucket.recordCode}.`);
    const matchingFields = egCountFields.filter(
      (field) => relativeFieldPath(field.path) === aggregateMapping.converterPath,
    );
    if (matchingFields.length !== 1)
      throw new Error(
        `Il mapping aggregato ${bucket.recordCode} identifica ${matchingFields.length} campi canonici.`,
      );
    return {
      ...bucket,
      fieldId: matchingFields[0]!.canonicalId,
      ...aggregateMapping,
    };
  });
  const rows = parityRows.filter((row) => {
    const field = listQuadroFields(row.quadro).find(
      (candidate) => candidate.canonicalId === row.fieldId,
    );
    return field
      ? requiresOfficialApplicationEvidence(row.quadro, field) ||
          SOURCE_QUALIFIED_OVERRIDES.has(row.fieldId)
      : false;
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
  const layout = parityRows
    .flatMap((row): LayoutEvidence[] => {
      const recordCode = recordCodeByPath.get(
        `${row.quadro}|${relativeFieldPath(row.technicalPath)}`,
      );
      if (!recordCode) return [];
      const layoutKey = `${row.quadro}|${recordCode}`;
      const position = layoutByQuadroAndCode.get(layoutKey);
      return position
        ? [
            {
              fieldId: row.fieldId,
              quadro: row.quadro,
              recordCode,
              ...position,
              uiControls: [...(controlsByCode.get(recordCode) ?? [])].sort(),
              radioGroup: radioGroupByQuadroAndCode.get(layoutKey) ?? null,
            },
          ]
        : [];
    })
    .sort(
      (left, right) =>
        left.quadro.localeCompare(right.quadro, "it") ||
        left.order - right.order ||
        left.fieldId.localeCompare(right.fieldId, "it"),
    );
  const counts = {
    reviewedFields: fields.length,
    layoutFields: layout.length,
    attachmentBuckets: qualifiedAttachmentBuckets.length,
    conditionalRules: conditionalRules.length,
    screenCommands: screenCommands.length,
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
    evidence: {
      schemaVersion: 5,
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
      layout,
      attachmentBuckets: qualifiedAttachmentBuckets,
      conditionalRules,
      screenModel: {
        schemaVersion: 1,
        file: "successionionline-screen-commands.json",
      },
    },
    screenCommands,
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
  const evidencePath = resolve(
    process.cwd(),
    "src/domain/official-catalog/successionionline-field-evidence.json",
  );
  const screenModelPath = resolve(
    process.cwd(),
    "src/domain/official-catalog/successionionline-screen-commands.json",
  );
  const { evidence, screenCommands } = await buildOfficialApplicationEvidence(sourceDirectory);
  const formattedEvidence = await format(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  if (formattedEvidence.errors.length > 0)
    throw new Error(`Impossibile formattare l’evidenza: ${formattedEvidence.errors[0]?.message}`);
  const formattedScreenModel = await format(
    screenModelPath,
    `${JSON.stringify({ schemaVersion: 1, commands: screenCommands }, null, 2)}\n`,
  );
  if (formattedScreenModel.errors.length > 0)
    throw new Error(
      `Impossibile formattare il modello schermate: ${formattedScreenModel.errors[0]?.message}`,
    );
  await writeFile(evidencePath, formattedEvidence.code, "utf8");
  await writeFile(screenModelPath, formattedScreenModel.code, "utf8");
  console.log(
    `Evidenza SuccessioniOnLine aggiornata: ${evidence.counts.reviewedFields} campi (${evidence.counts.professionista} professionali, ${evidence.counts.automatico} automatici, ${evidence.counts["riservato-ufficio"]} riservati all’ufficio).`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();
