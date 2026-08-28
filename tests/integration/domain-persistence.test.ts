import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, openDatabase } from "../../src/lib/server/database.ts";
import {
  buildComplianceReport,
  confirmCalculationRun,
  confirmDevolutionScenario,
  createDeclarationSubjectEntry,
  createSharedAsset,
  createSharedSubject,
  listDeclarationDossierSubjects,
  listDeclarationSubjectEntries,
  listCalculationRuns,
  listDevolutionScenarios,
  listPracticeDeadlines,
  listSharedAssets,
  listSharedSubjects,
  runSuccessionCalculation,
  saveCanonicalField,
  saveCanonicalFields,
  saveDevolutionScenario,
  synchronizeChecklist,
  updateChecklistItem,
} from "../../src/lib/server/domain.ts";
import {
  createPractice,
  createSuccessiveDeclaration,
  getDeclaration,
  listDeclarations,
} from "../../src/lib/server/practices.ts";
import { searchWorkspace } from "../../src/lib/server/search.ts";
import { getCanonicalField } from "../../src/domain/declaration.ts";

const directories: string[] = [];
const BUILDING_VALUE_FIELD_ID = "xsd:/Fornitura/Dichiarazione/QuadroEC/Modulo/Fabbricati/Valore";
const BUILDING_PREVIOUS_VALUE_FIELD_ID =
  "xsd:/Fornitura/Dichiarazione/QuadroEC/Modulo/Fabbricati/ValorePrecSucc";
const VESSEL_LENGTH_FIELD_ID =
  "xsd:/Fornitura/Dichiarazione/QuadroEQ/Modulo/Navi/Tipo/Dimensione/Lunghezza";
const VESSEL_TONNAGE_FIELD_ID =
  "xsd:/Fornitura/Dichiarazione/QuadroEQ/Modulo/Navi/Tipo/Dimensione/Stazza";
const VESSEL_TYPE_FIELD_ID = "xsd:/Fornitura/Dichiarazione/QuadroEQ/Modulo/Navi/Tipo/TipoUnita";
const SUBSTITUTE_SUCCESSION_OPENING_DATE_FIELD_ID =
  "xsd:/Fornitura/Dichiarazione/QuadroEH/PrimoModulo/SezioneI_DichSost/DatiDefunto/Decesso/DataDecesso";
const TESTAMENT_FILE_NAME_FIELD_ID =
  "xsd:/Fornitura/Dichiarazione/QuadroEG/Testamento/TestamentoAll/FileName";
const MORTGAGE_TAX_FIELD_ID =
  "xsd:/Fornitura/Dichiarazione/QuadroEF/SezioneI_ImpostaIpotecaria/ImpostaProporzionale/ImpostaProporzionale_Imposta";
const MORTGAGE_TAX_BASE_FIELD_ID =
  "xsd:/Fornitura/Dichiarazione/QuadroEF/SezioneI_ImpostaIpotecaria/ImpostaProporzionale/ImpostaProporzionale_Imponibile";

afterEach(() => {
  for (const directory of directories.splice(0)) {
    closeDatabase(directory);
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("persistenza del procedimento", () => {
  it("condivide soggetti e beni fra dichiarazioni con snapshot separati", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-domain-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Procedimento sintetico");
    const originalSubject = createSharedSubject(database, practice.id, {
      role: "beneficiary",
      displayName: "Beneficiario Sintetico",
      taxCode: "RSSMRA80A01H501U",
    });
    const originalAsset = createSharedAsset(database, practice.id, {
      category: "property",
      displayName: "Immobile sintetico",
    });
    const next = createSuccessiveDeclaration(
      database,
      practice.id,
      practice.declarationId,
      "substitute-1",
    );

    expect(listSharedSubjects(database, practice.id)).toHaveLength(1);
    expect(listSharedAssets(database, practice.id)).toHaveLength(1);
    expect(listSharedAssets(database, practice.id, practice.declarationId)).toHaveLength(1);
    expect(listSharedAssets(database, practice.id, next.id)).toHaveLength(1);
    const laterAsset = createSharedAsset(database, practice.id, {
      kind: "money",
      displayName: "Rapporto della sostitutiva",
      declarationId: next.id,
    });
    expect(
      listSharedAssets(database, practice.id, practice.declarationId).map(({ id }) => id),
    ).toEqual([originalAsset.id]);
    expect(
      listSharedAssets(database, practice.id, next.id)
        .map(({ id }) => id)
        .sort(),
    ).toEqual([originalAsset.id, laterAsset.id].sort());
    expect(listDeclarations(database, practice.id)).toHaveLength(2);
    expect(
      listDeclarationSubjectEntries(database, practice.id, practice.declarationId),
    ).toHaveLength(1);
    expect(listDeclarationSubjectEntries(database, practice.id, next.id)).toHaveLength(1);
    expect(next.declaration.declarationKind).toBe("substitute-1");
    const laterSubject = createSharedSubject(database, practice.id, {
      role: "beneficiary",
      displayName: "Beneficiario della sostitutiva",
      taxCode: "VRDLGI80A01H501U",
      declarationId: next.id,
    });
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: next.id,
      expectedRevision: 1,
      fieldId: "quadro-ea.soggetto.codice-fiscale",
      value: "BNCLGU80A01H501S",
      entityId: originalSubject.id,
    });
    expect(listDeclarationDossierSubjects(database, practice.id, practice.declarationId)).toEqual([
      expect.objectContaining({ id: originalSubject.id, taxCode: "RSSMRA80A01H501U" }),
    ]);
    expect(listDeclarationDossierSubjects(database, practice.id, next.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: originalSubject.id, taxCode: "BNCLGU80A01H501S" }),
        expect.objectContaining({ id: laterSubject.id, taxCode: "VRDLGI80A01H501U" }),
      ]),
    );
  });

  it("persiste devoluzione, calcolo e conferme professionali senza salti di revisione", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-domain-flow-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Procedimento completo sintetico");
    const decedent = createSharedSubject(database, practice.id, {
      role: "decedent",
      displayName: "Defunto sintetico",
    });
    const beneficiary = createSharedSubject(database, practice.id, {
      role: "beneficiary",
      displayName: "Beneficiario sintetico",
      taxCode: "RSSMRA80A01H501U",
    });
    const asset = createSharedAsset(database, practice.id, {
      kind: "building",
      displayName: "Fabbricato sintetico",
      valueCents: 10_000_000n,
    });
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 1,
      fieldId: "quadro-ea.soggetto.tipo",
      value: "1",
      entityId: beneficiary.id,
    });
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 2,
      fieldId: "quadro-ea.soggetto.grado-parentela",
      value: "10",
      entityId: beneficiary.id,
    });
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 3,
      fieldId: "frontespizio.defunto.data-decesso",
      value: "01012025",
      entityId: decedent.id,
    });
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 4,
      fieldId: BUILDING_VALUE_FIELD_ID,
      value: "200000",
      entityId: asset.id,
    });
    const scenario = saveDevolutionScenario(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 5,
      shares: [
        {
          assetId: asset.id,
          beneficiaryId: beneficiary.id,
          numerator: 1n,
          denominator: 1n,
          rightCode: "1",
        },
      ],
    });
    expect(scenario).toMatchObject({ status: "draft", issues: [] });
    expect(() =>
      confirmDevolutionScenario(database, {
        practiceId: practice.id,
        declarationId: practice.declarationId,
        scenarioId: scenario.id,
        expectedRevision: 4,
      }),
    ).toThrow("REVISION_CONFLICT");
    expect(listDevolutionScenarios(database, practice.id, practice.declarationId)[0]?.status).toBe(
      "draft",
    );
    expect(
      confirmDevolutionScenario(database, {
        practiceId: practice.id,
        declarationId: practice.declarationId,
        scenarioId: scenario.id,
        expectedRevision: 5,
      }),
    ).toBe(6);

    const calculation = runSuccessionCalculation(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
    });
    expect(calculation).toMatchObject({ status: "blocked", totalTaxCents: 660_000n });
    expect(calculation.issues.map(({ id }) => id)).not.toContain("CALCULATION_RULES_INCOMPLETE");
    expect(calculation.issues.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        "CALCULATION_MORTGAGE_JURISDICTIONS_MISSING",
        "CALCULATION_STAMP_DUTY_JURISDICTIONS_MISSING",
      ]),
    );
    expect(() =>
      confirmCalculationRun(database, {
        practiceId: practice.id,
        declarationId: practice.declarationId,
        calculationId: calculation.id,
        expectedRevision: 6,
      }),
    ).toThrow("CALCULATION_NOT_CONFIRMABLE");
    expect(listCalculationRuns(database, practice.id, practice.declarationId)[0]?.status).toBe(
      "blocked",
    );
    expect(getDeclaration(database, practice.declarationId)?.declaration).toMatchObject({
      confirmedDevolutionScenarioId: scenario.id,
      latestCalculationRunId: null,
    });

    const updated = saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 6,
      fieldId: "quadro-ea.soggetto.grado-parentela",
      value: "11",
      entityId: beneficiary.id,
    });
    expect(updated.revision).toBe(7);
    expect(getDeclaration(database, practice.declarationId)?.declaration).toMatchObject({
      confirmedDevolutionScenarioId: null,
      latestCalculationRunId: null,
    });
    expect(listDevolutionScenarios(database, practice.id, practice.declarationId)[0]?.status).toBe(
      "superseded",
    );
    expect(listCalculationRuns(database, practice.id, practice.declarationId)[0]?.status).toBe(
      "superseded",
    );
    expect(() =>
      confirmCalculationRun(database, {
        practiceId: practice.id,
        declarationId: practice.declarationId,
        calculationId: calculation.id,
        expectedRevision: 7,
      }),
    ).toThrow("CALCULATION_NOT_CONFIRMABLE");

    const checklist = synchronizeChecklist(database, practice.id, practice.declarationId);
    const deathProof = checklist.find((item) => item.label.includes("decesso"));
    expect(deathProof?.status).toBe("missing");
    expect(
      updateChecklistItem(database, {
        practiceId: practice.id,
        declarationId: practice.declarationId,
        itemId: deathProof!.id,
        status: "available",
        documentId: null,
        decisionNote: null,
      }),
    ).toBe(false);
    const checklistDocumentId = "documento-checklist-sintetico";
    const checklistDocumentDate = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO documents(
           id, practice_id, original_name, media_type, byte_size, sha256, blob_path, created_at
         ) VALUES (?, ?, 'prova.pdf', 'application/pdf', 1, 'prova-checklist', 'blobs/aa/prova', ?)`,
      )
      .run(checklistDocumentId, practice.id, checklistDocumentDate);
    expect(
      updateChecklistItem(database, {
        practiceId: practice.id,
        declarationId: practice.declarationId,
        itemId: deathProof!.id,
        status: "available",
        documentId: checklistDocumentId,
        decisionNote: null,
      }),
    ).toBe(true);
    expect(
      updateChecklistItem(database, {
        practiceId: practice.id,
        declarationId: practice.declarationId,
        itemId: deathProof!.id,
        status: "overridden",
        documentId: null,
        decisionNote: "Deroga non consentita",
      }),
    ).toBe(false);
    expect(
      synchronizeChecklist(database, practice.id, practice.declarationId).find(
        (item) => item.id === deathProof!.id,
      )?.status,
    ).toBe("available");
  });

  it("non richiede la tempistica al trust senza pagamento anticipato", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-domain-trust-payment-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Procedimento trust sintetico");
    const decedent = createSharedSubject(database, practice.id, {
      role: "decedent",
      displayName: "Defunto sintetico",
    });
    const trust = createSharedSubject(database, practice.id, {
      role: "beneficiary",
      displayName: "Trust sintetico",
    });
    const asset = createSharedAsset(database, practice.id, {
      kind: "building",
      displayName: "Fabbricato sintetico",
      valueCents: 200_000_000n,
    });
    const fields = [
      ["quadro-ea.soggetto.tipo", "5", trust.id],
      ["quadro-ea.soggetto.grado-parentela", "35", trust.id],
      ["frontespizio.defunto.data-decesso", "01012025", decedent.id],
      [BUILDING_VALUE_FIELD_ID, "2000000", asset.id],
      ["xsd:/Fornitura/Dichiarazione/Frontespizio/Presentatore/CodiceCarica", "9", undefined],
    ] as const;
    let revision = 1;
    for (const [fieldId, value, entityId] of fields) {
      revision = saveCanonicalField(database, {
        practiceId: practice.id,
        declarationId: practice.declarationId,
        expectedRevision: revision,
        fieldId,
        value,
        entityId,
      }).revision;
    }
    const scenario = saveDevolutionScenario(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: revision,
      shares: [
        {
          assetId: asset.id,
          beneficiaryId: trust.id,
          numerator: 1n,
          denominator: 1n,
          rightCode: "1",
        },
      ],
    });
    confirmDevolutionScenario(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      scenarioId: scenario.id,
      expectedRevision: revision,
    });

    const calculation = runSuccessionCalculation(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
    });

    expect(calculation.declarationTaxes.successionTax.payableCents).toBeGreaterThan(0n);
    expect(calculation.paymentPlan).toMatchObject({ advanceTrustPayment: false });
    expect(calculation.issues.map(({ id }) => id)).not.toContain(
      "CALCULATION_PAYMENT_PLAN_TEMPISTICA_TRUST_NON_AMMESSA",
    );
    expect(calculation.issues.map(({ id }) => id)).not.toContain(
      "CALCULATION_PAYMENT_PLAN_TEMPISTICA_OBBLIGATORIA",
    );
  });

  it("rende superati ripartizione e calcolo quando viene aggiunto un nuovo bene", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-domain-stale-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Procedimento sintetico");
    const decedent = createSharedSubject(database, practice.id, {
      role: "decedent",
      displayName: "Defunto sintetico",
    });
    const beneficiary = createSharedSubject(database, practice.id, {
      role: "beneficiary",
      displayName: "Beneficiario sintetico",
    });
    const asset = createSharedAsset(database, practice.id, {
      kind: "building",
      displayName: "Fabbricato sintetico",
      valueCents: 20_000_000n,
    });
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 1,
      fieldId: "quadro-ea.soggetto.tipo",
      value: "1",
      entityId: beneficiary.id,
    });
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 2,
      fieldId: "quadro-ea.soggetto.grado-parentela",
      value: "10",
      entityId: beneficiary.id,
    });
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 3,
      fieldId: "frontespizio.defunto.data-decesso",
      value: "01012025",
      entityId: decedent.id,
    });
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 4,
      fieldId: BUILDING_VALUE_FIELD_ID,
      value: "200000",
      entityId: asset.id,
    });
    const scenario = saveDevolutionScenario(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 5,
      shares: [
        {
          assetId: asset.id,
          beneficiaryId: beneficiary.id,
          numerator: 1n,
          denominator: 1n,
          rightCode: "1",
        },
      ],
    });
    confirmDevolutionScenario(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      scenarioId: scenario.id,
      expectedRevision: 5,
    });
    const calculation = runSuccessionCalculation(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
    });
    expect(calculation.status).toBe("blocked");

    createSharedAsset(database, practice.id, {
      kind: "money",
      displayName: "Rapporto aggiunto",
      valueCents: 100_000n,
      declarationId: practice.declarationId,
    });

    expect(getDeclaration(database, practice.declarationId)?.declaration).toMatchObject({
      confirmedDevolutionScenarioId: null,
      latestCalculationRunId: null,
    });
    expect(listDevolutionScenarios(database, practice.id, practice.declarationId)[0]?.status).toBe(
      "superseded",
    );
    expect(listCalculationRuns(database, practice.id, practice.declarationId)[0]?.status).toBe(
      "superseded",
    );
  });

  it("salva un campo canonico soltanto se supera il controllo disponibile", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-domain-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Procedimento sintetico");
    const subject = createSharedSubject(database, practice.id, {
      role: "beneficiary",
      displayName: "Beneficiario Sintetico",
    });
    const invalid = saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 1,
      fieldId: "quadro-ea.soggetto.codice-fiscale",
      value: "ERRATO",
      entityId: subject.id,
    });
    expect(invalid.issues[0]?.id).toBe("XSD_PATTERN_MISMATCH");
    expect(getDeclaration(database, practice.declarationId)?.revision).toBe(1);

    const valid = saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 1,
      fieldId: "quadro-ea.soggetto.codice-fiscale",
      value: "RSSMRA80A01H501U",
      entityId: subject.id,
    });
    expect(valid).toMatchObject({ revision: 2, issues: [] });
    expect(buildComplianceReport(database, practice.id, practice.declarationId).ready).toBe(false);
  });

  it("applica ai campi anche i vincoli ereditati dal tipo XSD", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-domain-xsd-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Procedimento sintetico");
    const asset = createSharedAsset(database, practice.id, {
      kind: "building",
      displayName: "Fabbricato sintetico",
    });
    const result = saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 1,
      fieldId:
        "xsd:/Fornitura/Dichiarazione/QuadroEC/Modulo/Fabbricati/Possesso/PossessoDenominatore",
      value: "abc",
      entityId: asset.id,
    });
    expect(result.issues.map(({ id }) => id)).toContain("XSD_PATTERN_MISMATCH");
    expect(result.revision).toBe(1);
    const subject = createSharedSubject(database, practice.id, {
      role: "beneficiary",
      displayName: "Beneficiario sintetico",
    });
    const invalidUnion = saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 1,
      fieldId: "quadro-ea.soggetto.provincia-nascita",
      value: "XX",
      entityId: subject.id,
    });
    expect(invalidUnion.issues.map(({ id }) => id)).toContain("XSD_UNION_MISMATCH");
    expect(invalidUnion.revision).toBe(1);
    const validUnion = saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 1,
      fieldId: "quadro-ea.soggetto.provincia-nascita",
      value: "RM",
      entityId: subject.id,
    });
    expect(validUnion).toMatchObject({ revision: 2, issues: [] });
  });

  it("rimuove dal riepilogo i documenti richiesti non più previsti", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-domain-checklist-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Procedimento sintetico");
    const now = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO checklist_items(
           id, practice_id, declaration_id, requirement_kind, importance, label, status,
           source_refs_json, rule_version, document_id, decision_note, created_at, updated_at
         ) VALUES (?, ?, ?, 'source', 'blocking', ?, 'missing', '[]', 'superata', NULL, NULL, ?, ?)`,
      )
      .run(
        `voce-superata:${practice.declarationId}`,
        practice.id,
        practice.declarationId,
        "Documento superato",
        now,
        now,
      );

    const checklist = synchronizeChecklist(database, practice.id, practice.declarationId);

    expect(checklist.some((item) => item.label === "Documento superato")).toBe(false);
    expect(new Set(checklist.map((item) => item.label)).size).toBe(checklist.length);
    const report = buildComplianceReport(database, practice.id, practice.declarationId);
    expect(new Set(report.issues.map((issue) => issue.message)).size).toBe(report.issues.length);
    expect(report.qualification).toMatchObject({
      calculationRulesVersion: "2026.08.12",
      temporalRulesVersion: "2026.08.12",
      officialControl: { name: "SUC13", version: "2.3.1", blockingDiagnostics: 0 },
      attachments: { files: 0, totalBytes: 0, motivatedExceptions: 0 },
    });
  });

  it("mantiene la checklist legata alla devoluzione confermata", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-domain-confirmed-checklist-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Procedimento con devoluzione confermata");
    const beneficiary = createSharedSubject(database, practice.id, {
      role: "beneficiary",
      displayName: "Beneficiario",
    });
    const building = createSharedAsset(database, practice.id, {
      kind: "building",
      displayName: "Abitazione",
      valueCents: 20_000_000n,
    });
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 1,
      fieldId: BUILDING_VALUE_FIELD_ID,
      value: "200000",
      entityId: building.id,
    });
    const confirmed = saveDevolutionScenario(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 2,
      shares: [
        {
          assetId: building.id,
          beneficiaryId: beneficiary.id,
          numerator: 1n,
          denominator: 1n,
          rightCode: "1",
          reliefCode: "P",
        },
      ],
    });
    expect(confirmed.status).toBe("draft");
    confirmDevolutionScenario(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      scenarioId: confirmed.id,
      expectedRevision: 2,
    });
    const laterBlocked = saveDevolutionScenario(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 3,
      shares: [],
    });
    expect(laterBlocked.status).toBe("blocked");
    database
      .prepare("UPDATE devolution_scenarios SET updated_at = ? WHERE id = ?")
      .run("2099-01-01T00:00:00.000Z", laterBlocked.id);

    const checklist = synchronizeChecklist(database, practice.id, practice.declarationId);
    expect(
      checklist.some(
        (item) => item.label === "Dichiarazione e documenti per l’agevolazione prima casa",
      ),
    ).toBe(true);
  });

  it("richiede i riferimenti alla dichiarazione precedente soltanto nelle sostitutive", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-domain-declaration-kind-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Procedimento sintetico");
    const previousDeclarationFields = [
      "frontespizio.dichiarazione-precedente.anno",
      "frontespizio.dichiarazione-precedente.volume",
      "frontespizio.dichiarazione-precedente.numero",
    ];

    const firstIssues = buildComplianceReport(database, practice.id, practice.declarationId).issues;
    expect(
      firstIssues.some((issue) => previousDeclarationFields.includes(issue.fieldId ?? "")),
    ).toBe(false);

    const substitute = createSuccessiveDeclaration(
      database,
      practice.id,
      practice.declarationId,
      "substitute-1",
    );
    const substituteFields = buildComplianceReport(database, practice.id, substitute.id)
      .issues.filter((issue) => issue.id.startsWith("REQUIRED_FIELD_MISSING:"))
      .map((issue) => issue.fieldId);
    expect(substituteFields).toEqual(expect.arrayContaining(previousDeclarationFields));
  });

  it("usa soltanto la data del Frontespizio e blocca una data diversa nel Quadro EH", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-domain-opening-date-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Procedimento sintetico");
    const decedent = createSharedSubject(database, practice.id, {
      role: "decedent",
      displayName: "Defunto",
    });
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 1,
      fieldId: "frontespizio.defunto.data-decesso",
      value: "31122024",
      entityId: decedent.id,
    });
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 2,
      fieldId: SUBSTITUTE_SUCCESSION_OPENING_DATE_FIELD_ID,
      value: "01012025",
    });

    expect(getDeclaration(database, practice.declarationId)?.declaration.successionOpenedAt).toBe(
      "2024-12-31",
    );
    expect(
      buildComplianceReport(database, practice.id, practice.declarationId).issues.map(
        ({ id }) => id,
      ),
    ).toContain("SUCCESSION_OPENING_DATE_DIVERGENCE");

    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 3,
      fieldId: SUBSTITUTE_SUCCESSION_OPENING_DATE_FIELD_ID,
      value: "31122024",
    });
    expect(
      buildComplianceReport(database, practice.id, practice.declarationId).issues.some(
        ({ id }) => id === "SUCCESSION_OPENING_DATE_DIVERGENCE",
      ),
    ).toBe(false);
  });

  it("mostra in dashboard la scadenza ordinaria calcolata dalla data del decesso", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-domain-deadline-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Successione con scadenza");
    const decedent = createSharedSubject(database, practice.id, {
      role: "decedent",
      displayName: "Defunto",
    });
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 1,
      fieldId: "frontespizio.defunto.data-decesso",
      value: "15082025",
      entityId: decedent.id,
    });

    expect(listPracticeDeadlines(database, "2026-08-10")).toEqual([
      expect.objectContaining({
        practiceId: practice.id,
        practiceTitle: "Successione con scadenza",
        dueDate: "2026-08-15",
        timing: "soon",
        timingLabel: "Scade tra 5 giorni",
        sourceId: "SRC-05",
      }),
    ]);
    expect(listPracticeDeadlines(database, "2026-08-16")[0]).toEqual(
      expect.objectContaining({
        timing: "overdue",
        timingLabel: "Scaduta da 1 giorno",
      }),
    );

    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 2,
      fieldId:
        "xsd:/Fornitura/Dichiarazione/Frontespizio/Presentatore/DecorrenzaTerminePresentazione",
      value: "01092025",
    });
    expect(listPracticeDeadlines(database, "2026-08-10")[0]).toEqual(
      expect.objectContaining({
        dueDate: "2026-09-01",
        timing: "soon",
        timingLabel: "Scade tra 22 giorni",
      }),
    );

    const substitute = createSuccessiveDeclaration(
      database,
      practice.id,
      practice.declarationId,
      "substitute-1",
    );
    expect(
      getCanonicalField(
        substitute.declaration,
        "xsd:/Fornitura/Dichiarazione/Frontespizio/Presentatore/DecorrenzaTerminePresentazione",
      ),
    ).toBeUndefined();
    expect(listPracticeDeadlines(database, "2026-08-10")[0]).toEqual(
      expect.objectContaining({
        dueDate: null,
        timing: "unqualified",
        timingLabel:
          "Decorrenza particolare: indica la data da cui parte il termine di dodici mesi",
      }),
    );
  });

  it("impedisce la modifica manuale dei dati tecnici degli allegati", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-domain-occurrences-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Procedimento sintetico");
    const firstOccurrence = "11111111-1111-4111-8111-111111111111";
    const result = saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 1,
      fieldId: TESTAMENT_FILE_NAME_FIELD_ID,
      value: "TESTAMENTO-PRIMO.PDF",
      occurrenceId: firstOccurrence,
    });

    expect(result.revision).toBe(1);
    expect(result.issues.map(({ id }) => id)).toEqual(["TECHNICAL_FIELD_NOT_EDITABLE"]);
    expect(
      getCanonicalField(
        getDeclaration(database, practice.declarationId)!.declaration,
        TESTAMENT_FILE_NAME_FIELD_ID,
        null,
        firstOccurrence,
      ),
    ).toBeUndefined();
  });

  it("controlla i campi obbligatori dei quadri compilati senza beni o soggetti propri", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-domain-static-quadro-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Procedimento sintetico");

    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 1,
      fieldId: MORTGAGE_TAX_FIELD_ID,
      value: "200",
    });

    expect(
      buildComplianceReport(database, practice.id, practice.declarationId).issues.map(
        ({ id }) => id,
      ),
    ).toContain(`REQUIRED_FIELD_MISSING:${MORTGAGE_TAX_BASE_FIELD_ID}:declaration`);
  });

  it("controlla i campi obbligatori nel ramo attivo e una sola alternativa XSD", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-domain-required-branches-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Procedimento sintetico");
    const beneficiary = createSharedSubject(database, practice.id, {
      role: "beneficiary",
      displayName: "Beneficiario",
    });
    const building = createSharedAsset(database, practice.id, {
      kind: "building",
      displayName: "Fabbricato",
    });
    const vessel = createSharedAsset(database, practice.id, {
      kind: "vessel",
      displayName: "Imbarcazione",
    });
    const cadastralSheet =
      "xsd:/Fornitura/Dichiarazione/QuadroEC/Modulo/Fabbricati/DatiFabbricati/DatiCatastali/Foglio";
    const cadastralParcel =
      "xsd:/Fornitura/Dichiarazione/QuadroEC/Modulo/Fabbricati/DatiFabbricati/DatiCatastali/Particella";
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 1,
      fieldId: cadastralSheet,
      value: "12",
      entityId: building.id,
    });
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 2,
      fieldId: VESSEL_TYPE_FIELD_ID,
      value: "1",
      entityId: vessel.id,
    });

    const missing = buildComplianceReport(database, practice.id, practice.declarationId).issues;
    expect(missing).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `REQUIRED_FIELD_MISSING:quadro-ea.soggetto.codice-fiscale:${beneficiary.id}`,
        }),
        expect.objectContaining({
          id: `REQUIRED_FIELD_MISSING:${cadastralParcel}:${building.id}`,
        }),
        expect.objectContaining({
          id: `REQUIRED_CHOICE_MISSING:choice-17:${vessel.id}`,
        }),
      ]),
    );

    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 3,
      fieldId: VESSEL_LENGTH_FIELD_ID,
      value: "750",
      entityId: vessel.id,
    });
    expect(
      buildComplianceReport(database, practice.id, practice.declarationId).issues.some((issue) =>
        issue.id.startsWith(`REQUIRED_CHOICE_MISSING:choice-17:${vessel.id}`),
      ),
    ).toBe(false);

    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 4,
      fieldId: VESSEL_TONNAGE_FIELD_ID,
      value: "20",
      entityId: vessel.id,
    });
    expect(
      buildComplianceReport(database, practice.id, practice.declarationId).issues.map(
        ({ id }) => id,
      ),
    ).toContain(`CHOICE_EXCLUSIVITY_VIOLATION:choice-17:${vessel.id}`);
  });

  it("conserva i dati del Frontespizio sul defunto e li riprende nella dichiarazione successiva", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-domain-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Procedimento sintetico");
    const decedent = createSharedSubject(database, practice.id, {
      role: "decedent",
      displayName: "Mario Rossi",
    });
    const beneficiary = createSharedSubject(database, practice.id, {
      role: "beneficiary",
      displayName: "Beneficiario Sintetico",
    });
    const taxCodeFieldId = "frontespizio.defunto.codice-fiscale";
    const civilStatusFieldId = "frontespizio.defunto.stato-civile";
    const wrongSubject = saveCanonicalFields(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 1,
      entityId: beneficiary.id,
      fields: [{ fieldId: civilStatusFieldId, value: "3" }],
    });
    expect(wrongSubject.issues[0]?.id).toBe("DECEDENT_NOT_FOUND");
    expect(getDeclaration(database, practice.declarationId)?.revision).toBe(1);

    const invalid = saveCanonicalFields(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 1,
      entityId: decedent.id,
      fields: [
        { fieldId: taxCodeFieldId, value: "ERRATO" },
        { fieldId: civilStatusFieldId, value: "3" },
      ],
    });
    expect(invalid.issues[0]?.id).toBe("XSD_PATTERN_MISMATCH");
    expect(getDeclaration(database, practice.declarationId)?.revision).toBe(1);
    expect(listSharedSubjects(database, practice.id)[0]?.data).toEqual({});

    const saved = saveCanonicalFields(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 1,
      entityId: decedent.id,
      fields: [
        { fieldId: taxCodeFieldId, value: "RSSMRA80A01H501U" },
        { fieldId: civilStatusFieldId, value: "3" },
      ],
    });
    expect(saved).toMatchObject({ revision: 2, issues: [] });
    expect(listSharedSubjects(database, practice.id)[0]).toMatchObject({
      taxCode: "RSSMRA80A01H501U",
      data: {
        [taxCodeFieldId]: "RSSMRA80A01H501U",
        [civilStatusFieldId]: "3",
      },
    });
    const next = createSuccessiveDeclaration(
      database,
      practice.id,
      practice.declarationId,
      "substitute-1",
    );
    expect(getCanonicalField(next.declaration, taxCodeFieldId, decedent.id)?.value).toBe(
      "RSSMRA80A01H501U",
    );
    expect(getCanonicalField(next.declaration, civilStatusFieldId, decedent.id)?.value).toBe("3");
  });

  it("mantiene separati i valori dello stesso quadro per ciascun soggetto", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-domain-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Procedimento sintetico");
    const first = createSharedSubject(database, practice.id, {
      role: "beneficiary",
      displayName: "Primo beneficiario",
    });
    const second = createSharedSubject(database, practice.id, {
      role: "beneficiary",
      displayName: "Secondo beneficiario",
    });
    const fieldId = "quadro-ea.soggetto.codice-fiscale";
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 1,
      fieldId,
      value: "RSSMRA80A01H501U",
      entityId: first.id,
    });
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 2,
      fieldId,
      value: "VRDLGI80A01H501U",
      entityId: second.id,
    });
    const declaration = getDeclaration(database, practice.declarationId)!.declaration;
    expect(getCanonicalField(declaration, fieldId, first.id)?.value).toBe("RSSMRA80A01H501U");
    expect(getCanonicalField(declaration, fieldId, second.id)?.value).toBe("VRDLGI80A01H501U");
  });

  it("consente più posizioni per lo stesso soggetto e controlla le incoerenze ufficiali", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-domain-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Procedimento sintetico");
    const subject = createSharedSubject(database, practice.id, {
      role: "beneficiary",
      displayName: "Beneficiario ripetuto",
    });
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 1,
      fieldId: "quadro-ea.soggetto.tipo",
      value: "1",
      entityId: subject.id,
    });
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 2,
      fieldId: "quadro-ea.soggetto.grado-parentela",
      value: "02",
      entityId: subject.id,
    });
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 3,
      fieldId: "quadro-ea.soggetto.disabilita",
      value: "1",
      entityId: subject.id,
    });
    const duplicate = createDeclarationSubjectEntry(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      sourceEntryId: subject.id,
      expectedRevision: 4,
    });
    expect(duplicate.revision).toBe(5);
    expect(
      getCanonicalField(
        getDeclaration(database, practice.declarationId)!.declaration,
        "quadro-ea.soggetto.grado-parentela",
        duplicate.entry.id,
      )?.value,
    ).toBe("02");
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 5,
      fieldId: "quadro-ea.soggetto.tipo",
      value: "3",
      entityId: duplicate.entry.id,
    });
    const report = buildComplianceReport(database, practice.id, practice.declarationId);
    expect(report.issues.map((issue) => issue.id)).toContain("EA_REPEATED_SUBJECT_TYPE_CONFLICT");
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 6,
      fieldId: "quadro-ea.soggetto.tipo",
      value: "2",
      entityId: duplicate.entry.id,
    });
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 7,
      fieldId: "quadro-ea.soggetto.grado-parentela",
      value: "03",
      entityId: duplicate.entry.id,
    });
    expect(
      buildComplianceReport(database, practice.id, practice.declarationId).issues.map(
        (issue) => issue.id,
      ),
    ).toContain("EA_REPEATED_SUBJECT_RELATIONSHIP_MISMATCH");
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 8,
      fieldId: "quadro-ea.soggetto.grado-parentela",
      value: "02",
      entityId: duplicate.entry.id,
    });
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 9,
      fieldId: "quadro-ea.soggetto.disabilita",
      value: "0",
      entityId: duplicate.entry.id,
    });
    expect(
      buildComplianceReport(database, practice.id, practice.declarationId).issues.map(
        (issue) => issue.id,
      ),
    ).toContain("EA_REPEATED_SUBJECT_DISABILITY_MISMATCH");
  });

  it("mantiene il codice fiscale comune a tutte le posizioni dello stesso soggetto", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-domain-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Procedimento sintetico");
    const subject = createSharedSubject(database, practice.id, {
      role: "beneficiary",
      displayName: "Beneficiario ripetuto",
    });
    const duplicate = createDeclarationSubjectEntry(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      sourceEntryId: subject.id,
      expectedRevision: 1,
    });
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 2,
      fieldId: "quadro-ea.soggetto.codice-fiscale",
      value: "RSSMRA80A01H501U",
      entityId: duplicate.entry.id,
    });
    const declaration = getDeclaration(database, practice.declarationId)!.declaration;
    expect(
      getCanonicalField(declaration, "quadro-ea.soggetto.codice-fiscale", subject.id)?.value,
    ).toBe("RSSMRA80A01H501U");
    expect(listSharedSubjects(database, practice.id)[0]?.taxCode).toBe("RSSMRA80A01H501U");
  });

  it("usa il valore ufficiale del bene e conserva tutti i centesimi nella ripartizione", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-domain-values-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Procedimento sintetico");
    const beneficiaries = ["Primo", "Secondo", "Terzo"].map((displayName) =>
      createSharedSubject(database, practice.id, { role: "beneficiary", displayName }),
    );
    const building = createSharedAsset(database, practice.id, {
      kind: "building",
      displayName: "Fabbricato",
      valueCents: 1n,
    });
    const oneEuro = createSharedAsset(database, practice.id, {
      kind: "building",
      displayName: "Bene da un euro",
      valueCents: 100n,
    });
    const officialValueField = "xsd:/Fornitura/Dichiarazione/QuadroEC/Modulo/Fabbricati/Valore";
    const incomplete = saveDevolutionScenario(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 1,
      shares: beneficiaries.flatMap((beneficiary) => [
        {
          assetId: building.id,
          beneficiaryId: beneficiary.id,
          numerator: 1n,
          denominator: 3n,
          rightCode: "1",
        },
        {
          assetId: oneEuro.id,
          beneficiaryId: beneficiary.id,
          numerator: 1n,
          denominator: 3n,
          rightCode: "1",
        },
      ]),
    });
    expect(incomplete.status).toBe("blocked");
    expect(incomplete.issues.map(({ id }) => id)).toContain(
      "DEVOLUTION_OFFICIAL_ASSET_VALUE_MISSING",
    );
    expect(
      saveCanonicalField(database, {
        practiceId: practice.id,
        declarationId: practice.declarationId,
        expectedRevision: 1,
        fieldId: officialValueField,
        value: "10000",
        entityId: building.id,
      }),
    ).toMatchObject({ revision: 2, issues: [] });
    expect(
      saveCanonicalField(database, {
        practiceId: practice.id,
        declarationId: practice.declarationId,
        expectedRevision: 2,
        fieldId: officialValueField,
        value: "1",
        entityId: oneEuro.id,
      }),
    ).toMatchObject({ revision: 3, issues: [] });
    expect(
      listSharedAssets(database, practice.id, practice.declarationId).find(
        ({ id }) => id === building.id,
      )?.valueCents,
    ).toBe("1000000");

    const scenario = saveDevolutionScenario(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 3,
      shares: [
        ...beneficiaries.map((beneficiary) => ({
          assetId: building.id,
          beneficiaryId: beneficiary.id,
          numerator: 1n,
          denominator: 3n,
          rightCode: "1",
        })),
        ...beneficiaries.map((beneficiary) => ({
          assetId: oneEuro.id,
          beneficiaryId: beneficiary.id,
          numerator: 1n,
          denominator: 3n,
          rightCode: "1",
        })),
      ],
    });
    expect(scenario.issues).toEqual([]);
    const buildingShares = scenario.shares.filter((share) => share.assetId === building.id);
    const centShares = scenario.shares.filter((share) => share.assetId === oneEuro.id);
    expect(buildingShares.map(({ valueCents }) => valueCents)).toEqual([
      333_334n,
      333_333n,
      333_333n,
    ]);
    expect(buildingShares.reduce((sum, share) => sum + share.valueCents, 0n)).toBe(1_000_000n);
    expect(centShares.map(({ valueCents }) => valueCents)).toEqual([34n, 33n, 33n]);
  });

  it("blocca soggetti non beneficiari e codici di devoluzione non ufficiali", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-domain-codes-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Procedimento sintetico");
    const representative = createSharedSubject(database, practice.id, {
      role: "representative",
      displayName: "Rappresentante",
    });
    const beneficiary = createSharedSubject(database, practice.id, {
      role: "beneficiary",
      displayName: "Beneficiario",
    });
    const asset = createSharedAsset(database, practice.id, {
      kind: "building",
      displayName: "Fabbricato",
      valueCents: 10_000n,
    });
    const invalid = saveDevolutionScenario(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 1,
      shares: [
        {
          assetId: asset.id,
          beneficiaryId: representative.id,
          numerator: 1n,
          denominator: 2n,
          rightCode: "inventato",
          reliefCode: "?",
        },
        {
          assetId: asset.id,
          beneficiaryId: beneficiary.id,
          numerator: 1n,
          denominator: 2n,
          rightCode: "1",
          reductionYears: 2,
        },
      ],
    });
    expect(invalid.status).toBe("blocked");
    expect(invalid.issues.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        "DEVOLUTION_BENEFICIARY_MISSING",
        "DEVOLUTION_RIGHT_CODE_INVALID",
        "DEVOLUTION_RELIEF_CODE_INVALID",
        "DEVOLUTION_REDUCTION_INCOMPLETE",
      ]),
    );
  });

  it("allinea la riduzione al valore ufficiale della successione precedente", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-domain-previous-succession-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Procedimento sintetico");
    const beneficiaries = ["Primo beneficiario", "Secondo beneficiario"].map((displayName) =>
      createSharedSubject(database, practice.id, { role: "beneficiary", displayName }),
    );
    const asset = createSharedAsset(database, practice.id, {
      kind: "building",
      displayName: "Fabbricato",
      valueCents: 100_000n,
    });
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 1,
      fieldId: BUILDING_VALUE_FIELD_ID,
      value: "1000",
      entityId: asset.id,
    });
    const missingOfficialPreviousValue = saveDevolutionScenario(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 2,
      shares: beneficiaries.map((beneficiary) => ({
        assetId: asset.id,
        beneficiaryId: beneficiary.id,
        numerator: 1n,
        denominator: 2n,
        rightCode: "1",
        reductionYears: 2,
        previousSuccessionValueCents: 5_000n,
      })),
    });
    expect(missingOfficialPreviousValue.issues.map(({ id }) => id)).toContain(
      "DEVOLUTION_OFFICIAL_PREVIOUS_SUCCESSION_VALUE_MISSING",
    );
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 2,
      fieldId: BUILDING_PREVIOUS_VALUE_FIELD_ID,
      value: "100",
      entityId: asset.id,
    });
    const shares = (firstValue: bigint, secondValue: bigint, secondYears: 2 | 3 = 2) => [
      {
        assetId: asset.id,
        beneficiaryId: beneficiaries[0]!.id,
        numerator: 1n,
        denominator: 2n,
        rightCode: "1",
        reductionYears: 2 as const,
        previousSuccessionValueCents: firstValue,
      },
      {
        assetId: asset.id,
        beneficiaryId: beneficiaries[1]!.id,
        numerator: 1n,
        denominator: 2n,
        rightCode: "1",
        reductionYears: secondYears,
        previousSuccessionValueCents: secondValue,
      },
    ];

    const divergent = saveDevolutionScenario(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 3,
      shares: shares(6_000n, 6_000n),
    });
    expect(divergent.issues.map(({ id }) => id)).toContain(
      "DEVOLUTION_PREVIOUS_SUCCESSION_VALUE_DIVERGENCE",
    );

    const inconsistentPeriod = saveDevolutionScenario(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 3,
      shares: shares(10_000n, 10_000n, 3),
    });
    expect(inconsistentPeriod.issues.map(({ id }) => id)).toContain(
      "DEVOLUTION_REDUCTION_PERIOD_INCONSISTENT",
    );

    const aligned = saveDevolutionScenario(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 3,
      shares: shares(10_000n, 10_000n),
    });
    expect(aligned.issues).toEqual([]);
    expect(aligned.status).toBe("draft");
  });

  it("non sceglie automaticamente fra più posizioni dello stesso beneficiario", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-domain-ambiguous-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Procedimento sintetico");
    const beneficiary = createSharedSubject(database, practice.id, {
      role: "beneficiary",
      displayName: "Beneficiario ripetuto",
    });
    const duplicate = createDeclarationSubjectEntry(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      sourceEntryId: beneficiary.id,
      expectedRevision: 1,
    });
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: duplicate.revision,
      fieldId: "quadro-ea.soggetto.tipo",
      value: "1",
      entityId: duplicate.entry.id,
    });
    const asset = createSharedAsset(database, practice.id, {
      kind: "building",
      displayName: "Fabbricato",
      valueCents: 10_000n,
    });
    const scenario = saveDevolutionScenario(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: duplicate.revision + 1,
      shares: [
        {
          assetId: asset.id,
          beneficiaryId: beneficiary.id,
          numerator: 1n,
          denominator: 1n,
          rightCode: "1",
        },
      ],
    });
    expect(scenario.status).toBe("blocked");
    expect(scenario.issues.map(({ id }) => id)).toContain(
      "DEVOLUTION_BENEFICIARY_POSITION_AMBIGUOUS",
    );
  });

  it("non rende confermabile il calcolo con regole fiscali di un periodo non qualificato", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-domain-period-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Procedimento sintetico");
    const decedent = createSharedSubject(database, practice.id, {
      role: "decedent",
      displayName: "Defunto",
    });
    const beneficiary = createSharedSubject(database, practice.id, {
      role: "beneficiary",
      displayName: "Beneficiario",
    });
    const asset = createSharedAsset(database, practice.id, {
      kind: "building",
      displayName: "Fabbricato",
      valueCents: 20_000_000n,
    });
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 1,
      fieldId: "quadro-ea.soggetto.tipo",
      value: "1",
      entityId: beneficiary.id,
    });
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 2,
      fieldId: "quadro-ea.soggetto.grado-parentela",
      value: "10",
      entityId: beneficiary.id,
    });
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 3,
      fieldId: "frontespizio.defunto.data-decesso",
      value: "31122024",
      entityId: decedent.id,
    });
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 4,
      fieldId: BUILDING_VALUE_FIELD_ID,
      value: "200000",
      entityId: asset.id,
    });
    const scenario = saveDevolutionScenario(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 5,
      shares: [
        {
          assetId: asset.id,
          beneficiaryId: beneficiary.id,
          numerator: 1n,
          denominator: 1n,
          rightCode: "1",
        },
      ],
    });
    confirmDevolutionScenario(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      scenarioId: scenario.id,
      expectedRevision: 5,
    });
    const calculation = runSuccessionCalculation(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
    });
    expect(calculation.status).toBe("blocked");
    expect(calculation.issues.map(({ id }) => id)).toContain("CALCULATION_PERIOD_NOT_QUALIFIED");
    expect(() =>
      confirmCalculationRun(database, {
        practiceId: practice.id,
        declarationId: practice.declarationId,
        calculationId: calculation.id,
        expectedRevision: 6,
      }),
    ).toThrow("CALCULATION_NOT_CONFIRMABLE");
  });

  it("non rende confermabile il calcolo finché manca la data del decesso", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-domain-missing-date-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Procedimento sintetico");
    const beneficiary = createSharedSubject(database, practice.id, {
      role: "beneficiary",
      displayName: "Beneficiario",
    });
    const asset = createSharedAsset(database, practice.id, {
      kind: "building",
      displayName: "Fabbricato",
      valueCents: 20_000_000n,
    });
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 1,
      fieldId: "quadro-ea.soggetto.tipo",
      value: "1",
      entityId: beneficiary.id,
    });
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 2,
      fieldId: "quadro-ea.soggetto.grado-parentela",
      value: "10",
      entityId: beneficiary.id,
    });
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 3,
      fieldId: BUILDING_VALUE_FIELD_ID,
      value: "200000",
      entityId: asset.id,
    });
    const scenario = saveDevolutionScenario(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 4,
      shares: [
        {
          assetId: asset.id,
          beneficiaryId: beneficiary.id,
          numerator: 1n,
          denominator: 1n,
          rightCode: "1",
        },
      ],
    });
    confirmDevolutionScenario(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      scenarioId: scenario.id,
      expectedRevision: 4,
    });
    const calculation = runSuccessionCalculation(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
    });
    expect(calculation.status).toBe("blocked");
    expect(calculation.issues.map(({ id }) => id)).toContain("CALCULATION_OPENING_DATE_MISSING");
  });

  it("non rende confermabile il calcolo con una data del decesso futura", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-domain-future-date-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Procedimento sintetico");
    const decedent = createSharedSubject(database, practice.id, {
      role: "decedent",
      displayName: "Defunto",
    });
    const beneficiary = createSharedSubject(database, practice.id, {
      role: "beneficiary",
      displayName: "Beneficiario",
    });
    const asset = createSharedAsset(database, practice.id, {
      kind: "building",
      displayName: "Fabbricato",
      valueCents: 20_000_000n,
    });
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 1,
      fieldId: "quadro-ea.soggetto.tipo",
      value: "1",
      entityId: beneficiary.id,
    });
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 2,
      fieldId: "quadro-ea.soggetto.grado-parentela",
      value: "10",
      entityId: beneficiary.id,
    });
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 3,
      fieldId: "frontespizio.defunto.data-decesso",
      value: "31122999",
      entityId: decedent.id,
    });
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 4,
      fieldId: BUILDING_VALUE_FIELD_ID,
      value: "200000",
      entityId: asset.id,
    });
    const scenario = saveDevolutionScenario(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 5,
      shares: [
        {
          assetId: asset.id,
          beneficiaryId: beneficiary.id,
          numerator: 1n,
          denominator: 1n,
          rightCode: "1",
        },
      ],
    });
    confirmDevolutionScenario(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      scenarioId: scenario.id,
      expectedRevision: 5,
    });

    const calculation = runSuccessionCalculation(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
    });
    expect(calculation.status).toBe("blocked");
    expect(calculation.issues.map(({ id }) => id)).toContain("CALCULATION_OPENING_DATE_FUTURE");
    expect(() =>
      confirmCalculationRun(database, {
        practiceId: practice.id,
        declarationId: practice.declarationId,
        calculationId: calculation.id,
        expectedRevision: 6,
      }),
    ).toThrow("CALCULATION_NOT_CONFIRMABLE");
  });

  it("blocca il calcolo se l’imposta estera ripartita diverge dal Quadro del bene", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-domain-foreign-tax-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Procedimento sintetico");
    const decedent = createSharedSubject(database, practice.id, {
      role: "decedent",
      displayName: "Defunto",
    });
    const beneficiary = createSharedSubject(database, practice.id, {
      role: "beneficiary",
      displayName: "Beneficiario",
    });
    const asset = createSharedAsset(database, practice.id, {
      kind: "building",
      displayName: "Fabbricato estero",
      valueCents: 20_000_000n,
    });
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 1,
      fieldId: "quadro-ea.soggetto.tipo",
      value: "1",
      entityId: beneficiary.id,
    });
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 2,
      fieldId: "quadro-ea.soggetto.grado-parentela",
      value: "10",
      entityId: beneficiary.id,
    });
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 3,
      fieldId: "frontespizio.defunto.data-decesso",
      value: "01012025",
      entityId: decedent.id,
    });
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 4,
      fieldId: BUILDING_VALUE_FIELD_ID,
      value: "200000",
      entityId: asset.id,
    });
    saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 5,
      fieldId: "xsd:/Fornitura/Dichiarazione/QuadroEC/Modulo/Fabbricati/ImpostaVersataEstero",
      value: "100",
      entityId: asset.id,
    });
    const scenario = saveDevolutionScenario(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 6,
      shares: [
        {
          assetId: asset.id,
          beneficiaryId: beneficiary.id,
          numerator: 1n,
          denominator: 1n,
          rightCode: "1",
          foreignTaxCents: 5_000n,
        },
      ],
    });
    confirmDevolutionScenario(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      scenarioId: scenario.id,
      expectedRevision: 6,
    });
    const calculation = runSuccessionCalculation(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
    });
    expect(calculation.status).toBe("blocked");
    expect(calculation.issues.map(({ id }) => id)).toContain("CALCULATION_FOREIGN_TAX_DIVERGENCE");
  });

  it("trova anche soggetti e beni tramite l’indice di ricerca", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-domain-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Procedimento sintetico");
    createSharedSubject(database, practice.id, {
      role: "beneficiary",
      displayName: "Elena Ricercabile",
    });
    createSharedAsset(database, practice.id, {
      category: "financial",
      displayName: "Rapporto Bancario Ricercabile",
    });
    expect(searchWorkspace(database, "Elena")[0]?.kind).toBe("subject");
    expect(searchWorkspace(database, "Bancario")[0]?.kind).toBe("asset");
  });

  it("non consente di registrare due defunti nella stessa pratica", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-domain-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Procedimento sintetico");
    createSharedSubject(database, practice.id, {
      role: "decedent",
      displayName: "Primo soggetto sintetico",
    });
    expect(() =>
      createSharedSubject(database, practice.id, {
        role: "decedent",
        displayName: "Secondo soggetto sintetico",
      }),
    ).toThrow("DECEDENT_ALREADY_EXISTS");
  });
});
