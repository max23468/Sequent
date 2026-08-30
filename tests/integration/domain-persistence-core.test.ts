import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/lib/server/database.ts";
import { createSharedAsset, listSharedAssets } from "../../src/lib/server/domain-assets.ts";
import {
  confirmCalculationRun,
  listCalculationRuns,
  runSuccessionCalculation,
} from "../../src/lib/server/domain-calculations.ts";
import {
  synchronizeChecklist,
  updateChecklistItem,
} from "../../src/lib/server/domain-checklist.ts";
import { buildComplianceReport } from "../../src/lib/server/domain-compliance.ts";
import {
  confirmDevolutionScenario,
  listDevolutionScenarios,
  saveDevolutionScenario,
} from "../../src/lib/server/domain-devolution.ts";
import { saveCanonicalField } from "../../src/lib/server/domain-fields.ts";
import {
  createSharedSubject,
  listDeclarationDossierSubjects,
  listDeclarationSubjectEntries,
  listSharedSubjects,
} from "../../src/lib/server/domain-subjects.ts";
import {
  createPractice,
  createSuccessiveDeclaration,
  getDeclaration,
  listDeclarations,
} from "../../src/lib/server/practices.ts";
import {
  cleanupDomainDirectories,
  directories,
  BUILDING_VALUE_FIELD_ID,
} from "./domain-persistence-support.ts";

afterEach(cleanupDomainDirectories);

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
      kind: "building",
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
        "CALCULATION_CONSERVATORY_NOT_FOUND",
        "CALCULATION_PAYMENT_PLAN_TEMPISTICA_OBBLIGATORIA",
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
});
