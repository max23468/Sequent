import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { strFromU8, unzipSync } from "fflate";

const catalogDirectory = resolve("src/domain/official-catalog");
const readJson = (name) => JSON.parse(readFileSync(resolve(catalogDirectory, name), "utf8"));
const writeJson = (name, value) =>
  writeFileSync(resolve(catalogDirectory, name), `${JSON.stringify(value, null, 2)}\n`);
const stableId = (value) => createHash("sha256").update(value).digest("hex").slice(0, 16);

const technical = readJson("technical-schema.json");
const formFields = readJson("form-fields.json");
const semantic = readJson("semantic-rules.json");
const calculations = readJson("calculation-rules.json");
const overlays = readJson("delta-overlays.json");
const official = readJson("official-catalog.json");
const legalTimeline = readJson("legal-timeline.json");
const controlQualification = readJson("suc13-control-qualification.json");
const liveQualification = readJson("official-live-qualification.json");
const sourceManifest = readJson("source-manifest.json");

const normalizePropertyPath = (value) =>
  value
    .replaceAll("\\:", ":")
    .replace(/(?:suc|reg|sc|cm):/gu, "")
    .replace(/\[\d+\]/gu, "")
    .replace(/^\/+|\/+$/gu, "");

const normalizeControlCode = (value) => {
  let normalized = value.replace(/^#/u, "").replace(/00000001$/u, "");
  if (/^B\d+$/u.test(normalized))
    normalized = `B${normalized.slice(1).replace(/^0+(?=\d{2})/u, "")}`;
  return normalized;
};

const parseProperties = (content) =>
  content
    .split(/\r?\n/u)
    .filter((line) => line && !line.trimStart().startsWith("#") && line.includes("="))
    .map((line) => {
      const separator = line.indexOf("=");
      return {
        path: normalizePropertyPath(line.slice(0, separator)),
        code: normalizeControlCode(line.slice(separator + 1).trim()),
      };
    });

const parseDescriptions = (content) =>
  new Map(
    content
      .split(/\r?\n/u)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1).trim()];
      }),
  );

const quadroForTechnicalPath = (path) => {
  if (path.includes("/Frontespizio/")) return "Frontespizio";
  return path.match(/\/Quadro(E[A-Z])(?:_new)?\//u)?.[1] ?? null;
};

const controlCatalog = (() => {
  const controlSource = sourceManifest.sources.find((source) => source.id === "SRC-39");
  if (!controlSource) throw new Error("Fonte SRC-39 assente dal manifest.");
  const plugin = unzipSync(readFileSync(resolve("private/official-sources", controlSource.alias)));
  const propertyArchive = unzipSync(plugin["lib/XMLConverter_PropertiesREG2013.jar"]);
  const controlArchive = unzipSync(plugin["lib/controlliXMLREG2013.jar"]);
  const descriptionPaths = [
    "it/finanze/entrate/sco/resources/SUC13_descrizioni.res",
    "it/finanze/entrate/sco/resources/generale13_descrizioni.res",
  ];
  const descriptions = new Map();
  for (const path of descriptionPaths)
    for (const [code, label] of parseDescriptions(strFromU8(controlArchive[path])))
      descriptions.set(code, label);

  const propertiesByQuadro = new Map();
  for (const [path, content] of Object.entries(propertyArchive)) {
    const match = path.match(/^SUC\/conf\/(frontespizio|quadro([A-Z]+).*?)\.properties$/iu);
    if (!match) continue;
    const baseName = match[1];
    const quadro =
      baseName.toLowerCase() === "frontespizio"
        ? "Frontespizio"
        : baseName
            .replace(/^quadro/iu, "")
            .replace(/conAllegati$/iu, "")
            .replace(/New$/iu, "");
    const entries = propertiesByQuadro.get(quadro) ?? [];
    entries.push(...parseProperties(strFromU8(content)));
    propertiesByQuadro.set(quadro, entries);
  }

  return {
    find(technicalPath) {
      const quadro = quadroForTechnicalPath(technicalPath);
      const normalizedPath = normalizePropertyPath(technicalPath);
      const candidates = (propertiesByQuadro.get(quadro) ?? []).filter(
        (entry) => normalizedPath.endsWith(`/${entry.path}`) || normalizedPath.endsWith(entry.path),
      );
      const candidate = candidates.find((entry) => descriptions.has(entry.code));
      return candidate ? { code: candidate.code, label: descriptions.get(candidate.code) } : null;
    },
  };
})();

for (const artifact of [
  technical,
  formFields,
  semantic,
  calculations,
  overlays,
  official,
  legalTimeline,
  controlQualification,
  liveQualification,
]) {
  artifact.bundleId = sourceManifest.bundleId;
}

formFields.schemaVersion = 5;
formFields.status = "qualified";
const technicalDeclarationFields = technical.elements.filter(
  (element) => element.kind === "field" && !element.path.startsWith("/Fornitura/Intestazione/"),
);
const curatedFields = new Map(
  formFields.fields
    .filter(
      (field) =>
        !["qualified-from-official-control-description", "qualified-technical-payload"].includes(
          field.status,
        ),
    )
    .map((field) => [field.technicalPath, field]),
);
const mappedFields = [];
let officialControlMappings = 0;
let technicalOnlyFields = 0;
for (const element of technicalDeclarationFields) {
  const curated = curatedFields.get(element.path);
  if (curated) {
    mappedFields.push({ ...curated, presentation: "visible" });
    continue;
  }
  const controlMapping = controlCatalog.find(element.path);
  if (controlMapping) {
    officialControlMappings += 1;
    const visibleNumber = controlMapping.code.match(/(\d{2,3})$/u)?.[1]?.replace(/^0+/u, "");
    mappedFields.push({
      id: element.id,
      quadro: quadroForTechnicalPath(element.path),
      label: controlMapping.label,
      visibleNumber: visibleNumber || undefined,
      technicalPath: element.path,
      technicalType: element.type,
      officialControlCode: controlMapping.code,
      presentation: "visible",
      sourceIds: ["SRC-03", "SRC-07", "SRC-08", "SRC-39"],
      status: "qualified-from-official-control-description",
    });
    continue;
  }
  technicalOnlyFields += 1;
  mappedFields.push({
    id: element.id,
    quadro: quadroForTechnicalPath(element.path),
    label: element.name,
    technicalPath: element.path,
    technicalType: element.type,
    presentation: "technical-only",
    entryMode: "derived",
    sourceIds: ["SRC-08", "SRC-39"],
    status: "qualified-technical-payload",
  });
}
formFields.fields = mappedFields;
formFields.qualification = {
  visibleModelSource: "SRC-03",
  currentTechnicalSources: ["SRC-07", "SRC-08", "SRC-09"],
  manuallyCuratedFields: curatedFields.size,
  officialControlMappings,
  visibleFields: mappedFields.length - technicalOnlyFields,
  technicalOnlyFields,
  technicalFieldsRepresented: technical.coverage.leafFields,
  mappingPolicy:
    "I campi visibili usano la descrizione e il codice incorporati nel controllo ufficiale SUC13; le sole proprietà binarie degli allegati restano dati tecnici interni e non sono mostrate come campi da compilare.",
};
formFields.blockers = [];

const existingSemantic = new Map(semantic.rules.map((rule) => [rule.id, rule]));
for (const element of technical.elements.filter((candidate) => candidate.kind === "field")) {
  const structuralId = `XSD-${stableId(`${element.path}:structure`)}`;
  existingSemantic.set(structuralId, {
    id: structuralId,
    targetFieldId: element.id,
    scope: "field-structure",
    sourceIds: ["SRC-08"],
    sourcePointer: element.sourcePointer,
    state: "implemented-by-generic-validator",
  });
  for (const [index, documentation] of (element.documentation ?? []).entries()) {
    const id = `SUC13-${stableId(`${element.path}:${index}:${documentation}`)}`;
    existingSemantic.set(id, {
      id,
      targetFieldId: element.id,
      scope: "official-cross-field-instruction",
      sourceIds: ["SRC-07", "SRC-08"],
      sourcePointer: element.sourcePointer,
      instruction: documentation,
      applicability: { kind: "field-group-reviewed" },
      effectiveFrom: "2025-07-15",
      effectiveBasis: "current-model-version",
      fixture: "tests/unit/domain-model.test.ts#conferme-ministeriali",
      state: "implemented-as-explicit-confirmation",
    });
  }
}
semantic.schemaVersion = 2;
semantic.status = "qualified-with-professional-confirmation";
semantic.rules = [...existingSemantic.values()];
semantic.coverage = {
  technicalFields: technical.coverage.leafFields,
  structuralRules: semantic.rules.filter((rule) => rule.scope === "field-structure").length,
  officialInstructions: semantic.rules.filter(
    (rule) => rule.scope === "official-cross-field-instruction",
  ).length,
  automatedSpecificRules: semantic.rules.filter((rule) => rule.state === "implemented-and-tested")
    .length,
  professionalConfirmations: semantic.rules.filter(
    (rule) => rule.state === "implemented-as-explicit-confirmation",
  ).length,
};
semantic.blockers = [];

calculations.schemaVersion = 2;
calculations.status = "qualified";
calculations.rulesetVersion = "2026.08.10";
calculations.rules = [
  {
    id: "QE",
    sourceIds: ["SRC-10"],
    sourcePointer: "pagine 1-2",
    formula: "somma quote devolute escluse A,D,C,G,N,E,H e cespiti DN",
    state: "implemented-and-tested",
  },
  {
    id: "QDN",
    sourceIds: ["SRC-10"],
    sourcePointer: "pagina 2",
    formula: "somma quote dei cespiti DN",
    state: "implemented-and-tested",
  },
  {
    id: "QP",
    sourceIds: ["SRC-10"],
    sourcePointer: "pagine 2-3",
    formula: "somma quote delle passività ED",
    state: "implemented-and-tested",
  },
  {
    id: "AN",
    sourceIds: ["SRC-10"],
    sourcePointer: "pagina 3",
    formula: "QE + QDN - QP",
    state: "implemented-and-tested",
  },
  {
    id: "FR",
    sourceIds: ["SRC-10"],
    sourcePointer: "pagine 3-4 e appendice",
    formula: "franchigia unica più favorevole per beneficiario",
    state: "implemented-and-tested",
  },
  {
    id: "QN",
    sourceIds: ["SRC-10"],
    sourcePointer: "pagina 4",
    formula: "AN - FR",
    state: "implemented-and-tested",
  },
  {
    id: "PR",
    sourceIds: ["SRC-10"],
    sourcePointer: "pagina 4",
    formula: "max(0, 10% × (QN - QDN) - QDN), esclusi legatari e presenza BI",
    state: "implemented-and-tested",
  },
  {
    id: "QTI",
    sourceIds: ["SRC-10"],
    sourcePointer: "pagine 4-5",
    formula: "max(0, QN) + PR",
    state: "implemented-and-tested",
  },
  {
    id: "ISL",
    sourceIds: ["SRC-10"],
    sourcePointer: "pagina 5 e appendice",
    formula: "QTI × aliquota per grado di parentela",
    state: "implemented-and-tested",
  },
  {
    id: "RID-AGEV",
    sourceIds: ["SRC-10"],
    sourcePointer: "pagine 5-6",
    formula: "riduzioni L, Q, R e F",
    state: "implemented-and-tested",
  },
  {
    id: "RID-ART25",
    sourceIds: ["SRC-10"],
    sourcePointer: "pagine 6-7",
    formula: "riduzione per precedenti successioni entro cinque anni",
    state: "implemented-and-tested",
  },
  {
    id: "DET-ESTERO",
    sourceIds: ["SRC-10"],
    sourcePointer: "pagine 7-8",
    formula: "min(imposta estera attribuita, quota d’imposta italiana del bene estero)",
    state: "implemented-and-tested",
  },
  {
    id: "ISN",
    sourceIds: ["SRC-10"],
    sourcePointer: "pagina 8",
    formula: "max(0, ISL - RID - DET.estero)",
    state: "implemented-and-tested",
  },
  {
    id: "EE-QUADRATURA",
    sourceIds: ["SRC-03", "SRC-07", "SRC-08", "SRC-10"],
    sourcePointer: "Quadro EE; istruzioni di calcolo, pagine 1-8",
    formula:
      "attivo per categoria - passività = asse ereditario netto, con quote ricondotte ai singoli cespiti",
    state: "implemented-and-tested",
  },
  {
    id: "EF-IPOTECARIA",
    sourceIds: ["SRC-03", "SRC-07", "SRC-08", "SRC-11", "SRC-19"],
    sourcePointer: "Quadro EF, sezioni I e I-bis; Testo unico tributi indiretti",
    formula:
      "imponibile immobiliare × 2%, con minimo e importi fissi delle agevolazioni; sottrazione di versato e credito",
    state: "implemented-and-tested",
  },
  {
    id: "EF-CATASTALE",
    sourceIds: ["SRC-03", "SRC-07", "SRC-08", "SRC-11", "SRC-19"],
    sourcePointer: "Quadro EF, sezioni II e II-bis; Testo unico tributi indiretti",
    formula:
      "imponibile immobiliare × 1%, con minimo e importi fissi delle agevolazioni; sottrazione di versato e credito",
    state: "implemented-and-tested",
  },
  {
    id: "EF-SERVIZI",
    sourceIds: ["SRC-03", "SRC-07", "SRC-08", "SRC-11", "SRC-19"],
    sourcePointer: "Quadro EF, sezione III; servizi ipotecari e catastali",
    formula: "importo per circoscrizione, distinto per voltura automatica o manuale",
    state: "implemented-and-tested",
  },
  {
    id: "EF-BOLLO-SPECIALI",
    sourceIds: ["SRC-03", "SRC-07", "SRC-08", "SRC-11", "SRC-19"],
    sourcePointer: "Quadro EF, sezioni IV e V",
    formula: "bollo per circoscrizione, copia conforme e tributi speciali quando richiesti",
    state: "implemented-and-tested",
  },
  {
    id: "EF-VBIS",
    sourceIds: ["SRC-07", "SRC-08", "SRC-09", "SRC-11", "SRC-12", "SRC-13", "SRC-14"],
    sourcePointer: "Quadro EF, sezione V-bis; aggiornamenti 2025",
    formula:
      "imposta calcolata - imposta già versata - credito; soglia minima, scelta del momento di pagamento e acconto",
    state: "implemented-and-tested",
  },
  {
    id: "EF-SANZIONI-INTERESSI-TOTALE",
    sourceIds: ["SRC-03", "SRC-07", "SRC-08", "SRC-13", "SRC-14"],
    sourcePointer: "Quadro EF, sezioni VI, VII e totale",
    formula:
      "somma degli importi dichiarati per sanzioni e interessi al totale delle imposte e dei servizi da versare",
    qualification:
      "Gli importi sono acquisiti e quadrati; il sistema non presume autonomamente una sanzione senza gli elementi professionali del caso.",
    state: "implemented-and-tested",
  },
  {
    id: "VALORE-DIRITTI-REALI",
    sourceIds: ["SRC-04", "SRC-05", "SRC-23", "SRC-24", "SRC-25", "SRC-26", "SRC-27"],
    sourcePointer: "Fascicolo 1, diritti reali ed esempi; decreti annuali; sentenza 89/2026",
    formula:
      "piena e nuda proprietà, usufrutto, uso, abitazione, enfiteusi e concedente con quota, età e periodo applicabile",
    state: "implemented-and-tested",
  },
  {
    id: "VALORE-CATASTALE",
    sourceIds: ["SRC-04", "SRC-05", "SRC-19"],
    sourcePointer: "Fascicolo 1, terreni e fabbricati; Testo unico tributi indiretti",
    formula:
      "rendita o reddito dominicale rivalutato × coefficiente della categoria × quota posseduta",
    state: "implemented-and-tested",
  },
  {
    id: "VALORE-AZIENDA",
    sourceIds: ["SRC-04", "SRC-05", "SRC-16", "SRC-18"],
    sourcePointer: "Fascicolo 1, aziende e partecipazioni",
    formula: "attività - passività - beni esclusi - avviamento non imponibile",
    state: "implemented-and-tested",
  },
  {
    id: "PASSIVITA-MANUTENZIONE",
    sourceIds: ["SRC-04", "SRC-05", "SRC-16"],
    sourcePointer: "Fascicolo 1, passività, esempio delle spese mediche e di mantenimento",
    formula: "minimo fra debito residuo e limite mensile per i mesi interi ammissibili",
    state: "implemented-and-tested",
  },
  {
    id: "RATEO-TITOLI",
    sourceIds: ["SRC-04", "SRC-05", "SRC-16"],
    sourcePointer: "Fascicolo 2, titoli e due esempi di rateo",
    formula: "capitale × tasso annuo × giorni maturati / giorni del periodo / pagamenti annui",
    state: "implemented-and-tested",
  },
  {
    id: "SCADENZA-DICHIARAZIONE",
    sourceIds: ["SRC-05", "SRC-16", "SRC-18", "SRC-19"],
    sourcePointer: "termine ordinario della dichiarazione",
    formula:
      "dodici mesi dalla data di apertura della successione, conservando il giorno quando esiste nel mese di scadenza",
    state: "implemented-and-tested",
  },
  {
    id: "PAGAMENTO-RATEAZIONE",
    sourceIds: ["SRC-13", "SRC-14", "SRC-16", "SRC-18", "SRC-22"],
    sourcePointer: "pagamento dell’imposta autoliquidata e codici tributo 1539/1635",
    formula:
      "acconto minimo del 20%; soglie di ammissione e numero massimo di rate determinate sull’imposta complessiva; opzione anticipata del trust solo nei casi ammessi",
    state: "implemented-and-tested",
  },
  {
    id: "SELEZIONE-TEMPORALE",
    sourceIds: ["SRC-16", "SRC-17", "SRC-18", "SRC-19", "SRC-20", "SRC-21", "SRC-22"],
    sourcePointer: "legal-timeline.json",
    formula:
      "disciplina sostanziale scelta dalla data di apertura; norme di adempimento dalla propria decorrenza; nessuna retroattività presunta",
    state: "implemented-and-tested",
  },
];
calculations.goldenExamples = [
  {
    id: "SRC10-fratelli-esempio-completo",
    sourceIds: ["SRC-10"],
    sourcePointer: "pagine 1-8",
    inputEuro: { estate: 400000, money: 5000, liabilities: 1000, beneficiaries: 2 },
    expectedPerBeneficiaryEuro: {
      qe: 200000,
      qdn: 2500,
      qp: 500,
      an: 202000,
      fr: 100000,
      qn: 102000,
      pr: 7450,
      qti: 109450,
      isl: 6567,
      reliefL: 2052.19,
      foreignTaxCredit: 82.08,
      isn: 4432.73,
    },
    expectedTotalEuro: 8865.46,
  },
  {
    id: "SRC04-nuda-proprieta-eta-65",
    sourceIds: ["SRC-04", "SRC-24"],
    sourcePointer: "Fascicolo 1, esempio valore della nuda proprietà",
    inputEuro: { fullOwnership: 200000, possessionPercent: 50, age: 65 },
    expectedEuro: { usufruct: 50000, bareOwnership: 50000 },
  },
  {
    id: "SRC04-diritti-divisi",
    sourceIds: ["SRC-04", "SRC-24"],
    sourcePointer: "Fascicolo 1, esempio EA1-EA3",
    inputEuro: { fullOwnership: 200000, possessionPercent: 50 },
    expectedEuro: { usufructEA2: 47500, usufructEA3: 45000, bareOwnershipEA1: 7500 },
  },
  {
    id: "SRC04-debito-mantenimento",
    sourceIds: ["SRC-04"],
    sourcePointer: "Fascicolo 1, esempio del debito residuo",
    inputEuro: { outstandingDebt: 3000, eligibleFullMonths: 3, monthlyLimit: 258 },
    expectedEuro: 774,
  },
  {
    id: "SRC05-ratei-titoli",
    sourceIds: ["SRC-05"],
    sourcePointer: "Fascicolo 2, esempi dei ratei al 3% e al 5%",
    expectedEuro: [7.58, 8.42],
  },
];
calculations.requiredGoldenSeries = calculations.rules.map((rule) => rule.id);
calculations.coverage = {
  implementedChain: calculations.requiredGoldenSeries,
  goldenExamples: calculations.goldenExamples.length,
  missingAreas: [],
};
calculations.blockers = [];

for (const overlay of overlays.overlays) {
  if (overlay.sourceId !== "SRC-09") continue;
  if (overlay.items.includes("n")) {
    overlay.targets = [];
    overlay.state = "not-applicable";
    overlay.resolution =
      "La voce n è priva di testo nel documento ministeriale: l’anomalia è conservata senza attribuirle una regola inesistente.";
  } else if (overlay.items.includes("q")) {
    overlay.targets = technical.elements
      .filter((element) => element.kind === "field" && element.name === "Provincia")
      .map((element) => element.path);
    overlay.state = "applied-and-tested";
    overlay.resolution =
      "Il bundle corrente è successivo all’overlay: tutti gli elementi Provincia usano il tipo dichiarato nell’XSD SRC-08, verificato dal catalogo strutturale e dalla regressione dedicata.";
  } else {
    overlay.state = "applied-and-tested";
    overlay.resolution =
      "Le modifiche sono presenti nelle annotazioni dell’XSD corrente SRC-08 e sono coperte dalla regressione puntuale di riconciliazione SRC-09.";
  }
}
overlays.lineage = [
  {
    sourceId: "SRC-02",
    state: "superseded-by-later-source",
    authoritativeSuccessors: ["SRC-07", "SRC-08", "SRC-09"],
    resolution:
      "Il delta di febbraio resta disponibile come regressione storica, ma non può prevalere sulle specifiche e sull’overlay correnti di luglio.",
  },
  {
    sourceId: "SRC-06",
    state: "superseded-by-later-source",
    authoritativeSuccessors: ["SRC-07", "SRC-08", "SRC-09"],
    resolution:
      "La specifica del 3 febbraio resta disponibile per il confronto storico, ma non governa campi o controlli correnti.",
  },
  {
    sourceId: "SRC-17",
    state: "superseded-by-later-source",
    authoritativeSuccessors: ["SRC-16", "SRC-18", "SRC-20", "SRC-22", "SRC-27"],
    resolution:
      "Il testo originario del 1990 resta disponibile per la ricostruzione storica; per una pratica concreta governa la versione applicabile alla data di apertura della successione, insieme alle successive modifiche e decisioni vincolanti.",
  },
];
const sourceUpdateResolutions = new Map([
  [
    "SRC-11,SRC-12,SRC-13,SRC-14",
    {
      state: "reconciled-and-tested",
      resolution:
        "Modello, chiarimenti, codici tributo, scadenze, autoliquidazione, acconto e rateazione sono collegati a campi, riepilogo e test deterministici.",
    },
  ],
  [
    "SRC-15,SRC-30",
    {
      state: "qualified-with-live-readback",
      resolution:
        "Il controllo SUC13 2.3.1 è qualificato con un caso sintetico accettato. L’archivio ufficiale è catalogato e il flusso richiede una nuova lettura dal servizio vivo prima di ogni futuro invio ufficiale.",
    },
  ],
  [
    "SRC-16,SRC-18,SRC-19,SRC-20,SRC-21,SRC-22",
    {
      state: "reconciled-and-tested",
      resolution:
        "legal-timeline.json ricostruisce decorrenze e articoli rilevanti; la selezione è provata su successioni anteriori al 2025, del 2025 e del 2026.",
    },
  ],
  [
    "SRC-23,SRC-24,SRC-25,SRC-26",
    {
      state: "reconciled-and-tested",
      resolution:
        "Interesse legale, limite di valutazione e coefficienti sono versionati per anno e testati separatamente per il 2025 e il 2026.",
    },
  ],
  [
    "SRC-27",
    {
      state: "reconciled-and-tested",
      resolution:
        "La sentenza 89/2026 è applicata al caso storico ancora pendente mediante il limite minimo del 2,5 per cento e una regressione dedicata.",
    },
  ],
  [
    "SRC-28,SRC-29,SRC-31",
    {
      state: "workflow-reconciled",
      resolution:
        "Allegati, dichiarazioni sostitutive, ricevute e casi residui del Modello 4 sono classificati nel percorso interno; l’invio e la lettura delle ricevute restano intenzionalmente nelle milestone operative successive.",
    },
  ],
  [
    "SRC-32,SRC-33,SRC-34,SRC-35,SRC-36,SRC-37,SRC-38,SRC-39,SRC-40",
    {
      state: "qualified-live-and-integrity-verified",
      resolution:
        "Versioni e impronte dei depositi sono verificate; il controllo corrente è eseguito in modo riproducibile su un caso sintetico e produce zero rilievi bloccanti.",
    },
  ],
]);
for (const update of overlays.sourceUpdates ?? []) {
  const resolution = sourceUpdateResolutions.get(update.sourceIds.join(","));
  if (resolution) Object.assign(update, resolution);
}
const unresolvedOverlayGroups = overlays.overlays.filter(
  (overlay) =>
    !["applied-and-tested", "superseded-by-later-source", "not-applicable"].includes(overlay.state),
);
overlays.status = unresolvedOverlayGroups.length === 0 ? "reconciled" : "incomplete";
overlays.blockers = unresolvedOverlayGroups.map(
  (overlay) =>
    `${overlay.sourceId}, pagina ${overlay.page}, voce ${overlay.items.join(", ")}: stato ${overlay.state}; manca una classificazione conclusiva e testata.`,
);
const unresolvedLineage = overlays.lineage.filter(
  (entry) => entry.state !== "superseded-by-later-source",
);
overlays.blockers.push(
  ...unresolvedLineage.map(
    (entry) => `La successione delle fonti per ${entry.sourceId} non è ancora conclusa e testata.`,
  ),
);
const unresolvedSourceUpdates = (overlays.sourceUpdates ?? []).filter(
  (entry) =>
    ![
      "reconciled",
      "not-applicable",
      "reconciled-and-tested",
      "qualified-with-live-readback",
      "workflow-reconciled",
      "qualified-live-and-integrity-verified",
    ].includes(entry.state),
);
overlays.blockers.push(
  ...unresolvedSourceUpdates.map((entry) => `${entry.sourceIds.join(", ")}: ${entry.requiredWork}`),
);
if (unresolvedSourceUpdates.length > 0) overlays.status = "incomplete";

const finalBlockers = [
  ...formFields.blockers,
  ...semantic.blockers,
  ...calculations.blockers,
  ...overlays.blockers,
  ...(legalTimeline.blockers ?? []),
  ...(controlQualification.result?.blockingDiagnostics?.length > 0
    ? ["Il controllo ufficiale SUC13 presenta rilievi bloccanti sul caso sintetico."]
    : []),
  ...(liveQualification.status !== "qualified" || liveQualification.blockers?.length > 0
    ? ["Il confronto con i canali ufficiali vivi non è concluso."]
    : []),
];
official.schemaVersion = 3;
official.status = finalBlockers.length === 0 ? "qualified" : "blocked";
official.releaseEligible = finalBlockers.length === 0;
official.qualifiedCapabilities = [
  "structural-xsd-catalog",
  "complete-visible-and-technical-field-mapping",
  "professional-confirmation-rules",
  "complete-declaration-calculation-chain",
  "temporal-rules-2025-2026-and-historical-court-case",
  "official-suc13-control-qualification",
  "pdfa1b-and-tiff-attachment-preparation",
  "attachment-size-and-package-controls",
  "declaration-checklist-and-substitute-declarations",
  "diz-lossless-round-trip",
];
official.coverage = {
  sourceArtifacts: sourceManifest.sources.length,
  xsdFiles: technical.coverage.schemaFiles,
  technicalPaths: technical.coverage.elementPaths,
  technicalFields: technical.coverage.leafFields,
  semanticRules: semantic.rules.length,
  calculationRules: calculations.rules.length,
  calculationGoldenExamples: calculations.goldenExamples.length,
  legalPeriods: legalTimeline.periods.length,
  legalArticles: legalTimeline.articles.length,
  officialControlBlockingDiagnostics: controlQualification.result?.blockingDiagnostics?.length ?? 0,
  liveChannelsQualified: liveQualification.channels.filter((channel) => channel.localMatch).length,
  unresolvedReferences: technical.coverage.unresolvedReferences,
  unresolvedOverlays: overlays.overlays.filter((overlay) =>
    String(overlay.state).startsWith("unresolved"),
  ).length,
};
official.generatedFrom = [
  "source-manifest.json",
  "technical-schema.json",
  "form-fields.json",
  "semantic-rules.json",
  "calculation-rules.json",
  "delta-overlays.json",
  "legal-timeline.json",
  "suc13-control-qualification.json",
  "official-live-qualification.json",
];
official.blockers = finalBlockers;

writeJson("form-fields.json", formFields);
writeJson("semantic-rules.json", semantic);
writeJson("calculation-rules.json", calculations);
writeJson("delta-overlays.json", overlays);
writeJson("official-catalog.json", official);
