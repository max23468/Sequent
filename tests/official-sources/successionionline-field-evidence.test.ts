import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { QUADRI, listQuadroFields } from "../../src/domain/official-catalog/catalog.ts";
import {
  buildOperationalParityMap,
  requiresOfficialApplicationEvidence,
} from "../../src/domain/operational-parity.ts";
import { sortForSuccessioniOnLine } from "../../src/domain/successionionline-layout.ts";

interface ApplicationEvidence {
  schemaVersion: number;
  application: {
    name: string;
    model: string;
    sources: Array<{ file: string; sha256: string }>;
  };
  counts: {
    reviewedFields: number;
    layoutFields: number;
    attachmentBuckets: number;
    conditionalRules: number;
    screenCommands: number;
    professionista: number;
    automatico: number;
    "riservato-ufficio": number;
  };
  fields: Array<{
    fieldId: string;
    recordCode: string;
    uiControls: string[];
    reviewedProducer: "professionista" | "automatico" | "riservato-ufficio";
    producerBasis: string;
  }>;
  layout: Array<{
    fieldId: string;
    quadro: string;
    recordCode: string;
    script: string;
    section: string;
    page: number;
    order: number;
    uiControls: string[];
    radioGroup: string | null;
  }>;
  attachmentBuckets: Array<{
    id: string;
    recordCode: string;
    fieldId: string;
    converterPath: string;
    sourcePointer: string;
    label: string;
    order: number;
  }>;
  conditionalRules: Array<{
    triggerRecordCode: string;
    triggerValue: "1";
    effect: "disable-while-selected";
    targetRecordCodes: string[];
    sourcePointer: string;
  }>;
  screenModel: {
    schemaVersion: number;
    file: string;
  };
}

interface ScreenEvidence {
  schemaVersion: number;
  commands: Array<{
    quadro: string;
    script: string;
    page: number;
    section: string;
    order: number;
    command: string;
    recordCodes: string[];
    arguments: string[];
    sourcePointer: string;
  }>;
}

async function readEvidence(): Promise<ApplicationEvidence> {
  return JSON.parse(
    await readFile("src/domain/official-catalog/successionionline-field-evidence.json", "utf8"),
  ) as ApplicationEvidence;
}

async function readScreenEvidence(): Promise<ScreenEvidence> {
  return JSON.parse(
    await readFile("src/domain/official-catalog/successionionline-screen-commands.json", "utf8"),
  ) as ScreenEvidence;
}

test("l’evidenza SuccessioniOnLine registra 257 campi e copre tutti i residui correnti", async () => {
  const evidence = await readEvidence();
  assert.equal(evidence.schemaVersion, 5);
  assert.equal(evidence.application.name, "SuccessioniOnLine");
  assert.equal(evidence.application.model, "SUC13");
  assert.deepEqual(evidence.counts, {
    reviewedFields: 257,
    layoutFields: 580,
    attachmentBuckets: 11,
    conditionalRules: 5,
    screenCommands: 2571,
    professionista: 230,
    automatico: 19,
    "riservato-ufficio": 8,
  });
  assert.equal(evidence.fields.length, evidence.counts.reviewedFields);
  assert.equal(new Set(evidence.fields.map(({ fieldId }) => fieldId)).size, evidence.fields.length);
  assert.ok(evidence.application.sources.every(({ sha256 }) => /^[a-f0-9]{64}$/u.test(sha256)));
  assert.deepEqual(
    evidence.application.sources.map(({ file }) => file),
    ["SUC13.jar", "SUC13_ResSUC13.jar", "XMLConverter_PropertiesREG2013.jar"],
  );
  const expectedFieldIds = QUADRI.flatMap((quadro) =>
    listQuadroFields(quadro)
      .filter((field) => field.visibleFieldId !== null)
      .filter((field) => requiresOfficialApplicationEvidence(quadro, field))
      .map((field) => field.canonicalId),
  ).sort();
  const evidenceFieldIds = evidence.fields.map(({ fieldId }) => fieldId).sort();
  assert.ok(expectedFieldIds.every((fieldId) => evidenceFieldIds.includes(fieldId)));
  const sourceQualifiedOverrides = evidence.fields.filter(
    ({ fieldId }) => !expectedFieldIds.includes(fieldId),
  );
  assert.equal(sourceQualifiedOverrides.length, 2);
  const rowsByFieldId = new Map(buildOperationalParityMap().map((row) => [row.fieldId, row]));
  assert.ok(
    sourceQualifiedOverrides.every(
      ({ fieldId }) => rowsByFieldId.get(fieldId)?.handlingBasis === "explicit-professional-input",
    ),
  );
});

test("estrae un modello di schermata riproducibile per ogni quadro ufficiale", async () => {
  const evidence = await readEvidence();
  const screenEvidence = await readScreenEvidence();
  assert.deepEqual(evidence.screenModel, {
    schemaVersion: 1,
    file: "successionionline-screen-commands.json",
  });
  assert.equal(screenEvidence.schemaVersion, evidence.screenModel.schemaVersion);
  assert.equal(screenEvidence.commands.length, evidence.counts.screenCommands);
  assert.deepEqual(
    [...new Set(screenEvidence.commands.map(({ quadro }) => quadro))],
    [
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
    ],
  );
  assert.ok(
    screenEvidence.commands.every(
      ({ page, order, command, sourcePointer }) =>
        page >= 1 && order >= 0 && command.length > 0 && sourcePointer.includes(".txt:"),
    ),
  );
  assert.deepEqual(
    screenEvidence.commands
      .filter(({ arguments: commandArguments }) => commandArguments[0] === "EA003A05")
      .map(({ command, recordCodes, sourcePointer }) => ({ command, recordCodes, sourcePointer })),
    [
      {
        command: "CampoInput",
        recordCodes: ["EA003A05"],
        sourcePointer:
          "SUC13_ResSUC13.jar#finanze/IDAC/resources/SUC13/localAppRoot/script/EA.txt:366",
      },
    ],
  );
  const egCommands = screenEvidence.commands.filter(({ quadro }) => quadro === "EG");
  assert.equal(egCommands.filter(({ command }) => command === "ListaFileSemaforo").length, 11);
  assert.equal(egCommands.filter(({ command }) => command === "CampoInput").length, 11);
  assert.deepEqual(
    [
      ...new Set(
        egCommands
          .filter(({ command }) => command === "ListaFileSemaforo")
          .flatMap(({ recordCodes }) => recordCodes),
      ),
    ],
    Array.from({ length: 11 }, (_, index) => `EG${String(index + 1).padStart(3, "0")}001`),
  );
});

test("registra gli 11 contenitori EG e le condizioni eseguite da SuccessioniOnLine", async () => {
  const evidence = await readEvidence();
  assert.deepEqual(
    evidence.attachmentBuckets.map(({ id, recordCode }) => [id, recordCode]),
    Array.from({ length: 11 }, (_, index) => [
      `EG${index + 1}`,
      `EG${String(index + 1).padStart(3, "0")}001`,
    ]),
  );
  assert.ok(evidence.attachmentBuckets.every(({ label }) => label.length > 3));
  assert.equal(new Set(evidence.attachmentBuckets.map(({ fieldId }) => fieldId)).size, 11);
  const egFieldsById = new Map(
    listQuadroFields("EG").map((field) => [field.canonicalId, field.path]),
  );
  assert.ok(
    evidence.attachmentBuckets.every(({ fieldId, converterPath, sourcePointer }) => {
      const technicalPath = egFieldsById.get(fieldId);
      return (
        technicalPath?.endsWith(`/${converterPath}`) &&
        sourcePointer ===
          `XMLConverter_PropertiesREG2013.jar#SUC/conf/quadroEG.properties:${converterPath}`
      );
    }),
  );
  assert.deepEqual(
    evidence.conditionalRules.map(({ triggerRecordCode }) => triggerRecordCode),
    ["EH000014", "EH000018", "EH000021", "EH000023", "EH000025"],
  );
  assert.ok(
    evidence.conditionalRules.every(
      ({ triggerValue, effect, targetRecordCodes, sourcePointer }) =>
        triggerValue === "1" &&
        effect === "disable-while-selected" &&
        targetRecordCodes.length > 0 &&
        sourcePointer.includes("EventiQuadroEH"),
    ),
  );
});

test("la vista a quadri segue l’ordine dei controlli di SuccessioniOnLine", async () => {
  const evidence = await readEvidence();
  assert.equal(evidence.layout.length, evidence.counts.layoutFields);
  assert.equal(new Set(evidence.layout.map(({ fieldId }) => fieldId)).size, evidence.layout.length);
  for (const item of evidence.layout) {
    assert.match(item.recordCode, /^(?:B|E[A-S])\d+/u);
    assert.ok(Number.isInteger(item.order) && item.order >= 0, item.fieldId);
    assert.ok(Number.isInteger(item.page) && item.page >= 1, item.fieldId);
    assert.ok(item.section.length > 0, item.fieldId);
    assert.ok(item.uiControls.length > 0, item.fieldId);
  }
  const radioFields = evidence.layout.filter(({ radioGroup }) => radioGroup !== null);
  assert.equal(radioFields.length, 19);
  assert.deepEqual([...new Set(radioFields.flatMap(({ uiControls }) => uiControls))].sort(), [
    "SingleRadio",
    "SingleRadioGroup",
  ]);
  assert.deepEqual(
    [...new Set(radioFields.map(({ radioGroup }) => radioGroup))]
      .map((radioGroup) => radioFields.filter((item) => item.radioGroup === radioGroup).length)
      .sort((left, right) => left - right),
    [2, 2, 2, 2, 2, 2, 2, 5],
  );
  const frontespizioSections = [
    ...new Set(
      evidence.layout
        .filter(({ quadro }) => quadro === "Frontespizio")
        .map(({ section }) => section),
    ),
  ];
  assert.deepEqual(frontespizioSections, [
    "Tipo di dichiarazione",
    "Beneficiari",
    "Dati del defunto",
    "Testamento",
    "Riservato a chi presenta il modello",
    "Riservato ai residenti all’estero",
    "Casi particolari",
    "Impegno alla presentazione telematica — Riservato all’intermediario/notaio",
    "Riservato agli uffici dell’agenzia delle entrate",
  ]);
  assert.deepEqual(
    [...new Set(evidence.layout.filter(({ quadro }) => quadro === "EH").map(({ page }) => page))],
    [1, 2, 3, 4],
  );
  assert.ok(
    evidence.layout.filter(({ quadro }) => quadro !== "EH").every(({ page }) => page === 1),
  );

  const frontespizio = sortForSuccessioniOnLine(
    listQuadroFields("Frontespizio").filter((field) => field.visibleFieldId !== null),
  );
  assert.deepEqual(
    frontespizio.slice(0, 5).map(({ label }) => label),
    [
      "Prima dichiarazione",
      "Dichiarazione sostitutiva",
      "Devoluzione per legge",
      "Devoluzione per testamento",
      "Applicazione di una legge estera",
    ],
  );
  assert.ok(
    frontespizio.findIndex(({ label }) => label === "Numero di eredi") <
      frontespizio.findIndex(({ label }) => label === "Codice fiscale del defunto"),
  );

  const ea = sortForSuccessioniOnLine(
    listQuadroFields("EA").filter((field) => field.visibleFieldId !== null),
  );
  assert.deepEqual(
    ea.slice(0, 4).map(({ label }) => label),
    ["Codice fiscale", "Tipo soggetto", "Rinuncia", "Grado di parentela"],
  );
});

test("ogni evidenza applicativa alimenta la matrice senza promozioni per analogia", async () => {
  const evidence = await readEvidence();
  const rowsByFieldId = new Map(buildOperationalParityMap().map((row) => [row.fieldId, row]));
  for (const field of evidence.fields) {
    const row = rowsByFieldId.get(field.fieldId);
    assert.ok(row, field.fieldId);
    assert.equal(row.semanticReview.status, "qualificata", field.fieldId);
    assert.ok(
      row.handlingBasis === "official-application-behavior" ||
        row.handlingBasis === "explicit-professional-input",
      field.fieldId,
    );
    if (row.handlingBasis === "explicit-professional-input")
      assert.equal(field.reviewedProducer, "professionista", field.fieldId);
    assert.ok(
      row.semanticReview.provenance.includes(
        `src/domain/official-catalog/successionionline-field-evidence.json#${field.recordCode}`,
      ),
      field.fieldId,
    );
    assert.equal(
      row.handling,
      field.reviewedProducer === "professionista"
        ? "inserito"
        : field.reviewedProducer === "automatico"
          ? "gestito-automaticamente"
          : "riservato-ufficio",
      field.fieldId,
    );
    if (field.producerBasis === "controllo-input-diretto")
      assert.ok(field.uiControls.length > 0, field.fieldId);
  }
});
