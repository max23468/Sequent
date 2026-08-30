import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/lib/server/database.ts";
import { createSharedAsset, listSharedAssets } from "../../src/lib/server/domain-assets.ts";
import { buildComplianceReport } from "../../src/lib/server/domain-compliance.ts";
import { saveDevolutionScenario } from "../../src/lib/server/domain-devolution.ts";
import { saveCanonicalField, saveCanonicalFields } from "../../src/lib/server/domain-fields.ts";
import {
  createDeclarationSubjectEntry,
  createSharedSubject,
  listSharedSubjects,
} from "../../src/lib/server/domain-subjects.ts";
import { listPracticeDeadlines } from "../../src/lib/server/domain-read-models.ts";
import {
  createPractice,
  createSuccessiveDeclaration,
  getDeclaration,
} from "../../src/lib/server/practices.ts";
import { getCanonicalField } from "../../src/domain/declaration.ts";
import {
  cleanupDomainDirectories,
  directories,
  VESSEL_LENGTH_FIELD_ID,
  VESSEL_TONNAGE_FIELD_ID,
  VESSEL_TYPE_FIELD_ID,
  SUBSTITUTE_SUCCESSION_OPENING_DATE_FIELD_ID,
  TESTAMENT_FILE_NAME_FIELD_ID,
  MORTGAGE_TAX_FIELD_ID,
  MORTGAGE_TAX_BASE_FIELD_ID,
} from "./domain-persistence-support.ts";

afterEach(cleanupDomainDirectories);

describe("persistenza del procedimento", () => {
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
});
