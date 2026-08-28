import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

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
const sourceManifest = readJson("source-manifest.json");

for (const artifact of [technical, formFields, semantic, calculations, overlays, official]) {
  artifact.bundleId = sourceManifest.bundleId;
}

formFields.schemaVersion = 5;
formFields.status = "incomplete";
const technicalDeclarationFields = technical.elements.filter(
  (element) => element.kind === "field" && !element.path.startsWith("/Fornitura/Intestazione/"),
);
const curatedTechnicalPaths = new Set(formFields.fields.map((field) => field.technicalPath));
const fieldsWithDerivedPresentation = technicalDeclarationFields.filter(
  (element) => !curatedTechnicalPaths.has(element.path),
).length;
formFields.qualification = {
  visibleModelSource: "SRC-03",
  currentTechnicalSources: ["SRC-07", "SRC-08", "SRC-09"],
  curatedVisibleFields: formFields.fields.length,
  technicalFieldsRepresented: technical.coverage.leafFields,
  fallbackPolicy:
    "I campi non ridefiniti nel livello visuale mantengono nome, ordine, tipo, vincoli e provenienza della fonte tecnica corrente; l’interfaccia li presenta con un’etichetta leggibile derivata dal nome ufficiale.",
};
formFields.blockers = [
  `${fieldsWithDerivedPresentation} campi della dichiarazione usano ancora una presentazione derivata dal nome tecnico e non una corrispondenza verificata con modello, numerazione e istruzioni visibili.`,
];

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
      state: "professional-confirmation-required",
    });
  }
}
semantic.schemaVersion = 2;
semantic.status = "classified-but-not-implemented";
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
    (rule) => rule.state === "professional-confirmation-required",
  ).length,
};
semantic.blockers = [
  `${semantic.coverage.professionalConfirmations} prescrizioni ministeriali sono classificate come conferme professionali, ma non hanno ancora condizione di applicabilità, periodo, fixture e conferma esplicita collegata al valore interessato.`,
];

calculations.schemaVersion = 2;
calculations.status = "partial-chain-only";
calculations.rulesetVersion = "2025.01.1";
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
];
calculations.requiredGoldenSeries = calculations.rules.map((rule) => rule.id);
calculations.coverage = {
  implementedChain: calculations.requiredGoldenSeries,
  goldenExamples: calculations.goldenExamples.length,
  missingAreas: [
    "Sezione V-bis del Quadro EF, credito, imposta da versare, acconto e rateazione",
    "imposte ipotecaria e catastale, servizi ipotecari e catastali, bollo e tributi speciali",
    "sanzioni, interessi e totale da versare",
    "valori catastali e diritti reali",
    "quadrature complete dei Quadri EE ed EF",
    "tutti gli esempi ufficiali ulteriori rispetto al caso completo già acquisito",
  ],
};
calculations.blockers = calculations.coverage.missingAreas.map(
  (area) => `Copertura di calcolo non ancora qualificata: ${area}.`,
);

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
  (entry) => !["reconciled", "not-applicable"].includes(entry.state),
);
overlays.blockers.push(
  ...unresolvedSourceUpdates.map((entry) => `${entry.sourceIds.join(", ")}: ${entry.requiredWork}`),
);
if (unresolvedSourceUpdates.length > 0) overlays.status = "incomplete";

official.schemaVersion = 2;
official.status = "blocked";
official.releaseEligible = false;
official.qualifiedCapabilities = [
  "structural-xsd-catalog",
  "succession-tax-chain-prototype-2025",
  "diz-prototype-round-trip",
];
official.coverage = {
  sourceArtifacts: sourceManifest.sources.length,
  xsdFiles: technical.coverage.schemaFiles,
  technicalPaths: technical.coverage.elementPaths,
  technicalFields: technical.coverage.leafFields,
  semanticRules: semantic.rules.length,
  calculationRules: calculations.rules.length,
  unresolvedReferences: technical.coverage.unresolvedReferences,
  unresolvedOverlays: overlays.overlays.filter((overlay) =>
    String(overlay.state).startsWith("unresolved"),
  ).length,
};
official.blockers = [
  ...formFields.blockers,
  ...semantic.blockers,
  ...calculations.blockers,
  ...overlays.blockers,
  "La checklist non copre ancora tutte le condizioni di allegati, dichiarazioni sostitutive, trust e agevolazione prima casa previste dalle fonti.",
  "La preparazione e validazione effettiva degli allegati PDF/A o TIFF non è ancora integrata nel flusso interno della pratica.",
];

writeJson("form-fields.json", formFields);
writeJson("semantic-rules.json", semantic);
writeJson("calculation-rules.json", calculations);
writeJson("delta-overlays.json", overlays);
writeJson("official-catalog.json", official);
