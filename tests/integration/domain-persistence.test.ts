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
    expect(scenario).toMatchObject({ status: "draft", issues: [] });
    expect(() =>
      confirmDevolutionScenario(database, {
        practiceId: practice.id,
        declarationId: practice.declarationId,
        scenarioId: scenario.id,
        expectedRevision: 3,
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
        expectedRevision: 4,
      }),
    ).toBe(5);

    const calculation = runSuccessionCalculation(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
    });
    expect(calculation).toMatchObject({ status: "draft", totalTaxCents: 660_000n, issues: [] });
    expect(
      confirmCalculationRun(database, {
        practiceId: practice.id,
        declarationId: practice.declarationId,
        calculationId: calculation.id,
        expectedRevision: 5,
      }),
    ).toBe(6);
    expect(listCalculationRuns(database, practice.id, practice.declarationId)[0]?.status).toBe(
      "confirmed",
    );
    expect(getDeclaration(database, practice.declarationId)?.declaration).toMatchObject({
      confirmedDevolutionScenarioId: scenario.id,
      latestCalculationRunId: calculation.id,
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
    ).toBe(true);
    expect(
      synchronizeChecklist(database, practice.id, practice.declarationId).find(
        (item) => item.id === deathProof!.id,
      )?.status,
    ).toBe("available");
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
    confirmCalculationRun(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      calculationId: calculation.id,
      expectedRevision: 5,
    });

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
    const oneCent = createSharedAsset(database, practice.id, {
      kind: "building",
      displayName: "Bene da un centesimo",
      valueCents: 1n,
    });
    const officialValueField = "xsd:/Fornitura/Dichiarazione/QuadroEC/Modulo/Fabbricati/Valore";
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
      listSharedAssets(database, practice.id, practice.declarationId).find(
        ({ id }) => id === building.id,
      )?.valueCents,
    ).toBe("1000000");

    const scenario = saveDevolutionScenario(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 2,
      shares: [
        ...beneficiaries.map((beneficiary) => ({
          assetId: building.id,
          beneficiaryId: beneficiary.id,
          numerator: 1n,
          denominator: 3n,
          rightCode: "1",
        })),
        ...beneficiaries.slice(0, 2).map((beneficiary) => ({
          assetId: oneCent.id,
          beneficiaryId: beneficiary.id,
          numerator: 1n,
          denominator: 2n,
          rightCode: "1",
        })),
      ],
    });
    expect(scenario.issues).toEqual([]);
    const buildingShares = scenario.shares.filter((share) => share.assetId === building.id);
    const centShares = scenario.shares.filter((share) => share.assetId === oneCent.id);
    expect(buildingShares.map(({ valueCents }) => valueCents)).toEqual([
      333_334n,
      333_333n,
      333_333n,
    ]);
    expect(buildingShares.reduce((sum, share) => sum + share.valueCents, 0n)).toBe(1_000_000n);
    expect(centShares.map(({ valueCents }) => valueCents)).toEqual([1n, 0n]);
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
    expect(calculation.issues.map(({ id }) => id)).toContain("CALCULATION_PERIOD_NOT_QUALIFIED");
    expect(() =>
      confirmCalculationRun(database, {
        practiceId: practice.id,
        declarationId: practice.declarationId,
        calculationId: calculation.id,
        expectedRevision: 5,
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
    const scenario = saveDevolutionScenario(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 3,
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
      expectedRevision: 3,
    });
    const calculation = runSuccessionCalculation(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
    });
    expect(calculation.status).toBe("blocked");
    expect(calculation.issues.map(({ id }) => id)).toContain("CALCULATION_OPENING_DATE_MISSING");
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
      fieldId: "xsd:/Fornitura/Dichiarazione/QuadroEC/Modulo/Fabbricati/ImpostaVersataEstero",
      value: "100",
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
          foreignTaxCents: 5_000n,
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
