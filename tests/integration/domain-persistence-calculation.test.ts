import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/lib/server/database.ts";
import { createSharedAsset } from "../../src/lib/server/domain-assets.ts";
import {
  confirmCalculationRun,
  runSuccessionCalculation,
} from "../../src/lib/server/domain-calculations.ts";
import {
  confirmDevolutionScenario,
  saveDevolutionScenario,
} from "../../src/lib/server/domain-devolution.ts";
import { saveCanonicalField, saveCanonicalFields } from "../../src/lib/server/domain-fields.ts";
import {
  createDeclarationSubjectEntry,
  createSharedSubject,
} from "../../src/lib/server/domain-subjects.ts";
import {
  createPractice,
  createSuccessiveDeclaration,
  getDeclaration,
} from "../../src/lib/server/practices.ts";
import { searchWorkspace } from "../../src/lib/server/search.ts";
import {
  cleanupDomainDirectories,
  directories,
  BUILDING_VALUE_FIELD_ID,
  BUILDING_PREVIOUS_VALUE_FIELD_ID,
  BUILDING_PROVINCE_FIELD_ID,
  BUILDING_MUNICIPALITY_FIELD_ID,
  BUILDING_ADMINISTRATIVE_MUNICIPALITY_FIELD_ID,
} from "./domain-persistence-support.ts";

afterEach(cleanupDomainDirectories);

describe("persistenza del procedimento", () => {
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

  it("calcola le circoscrizioni dalla conservatoria del Comune amministrativo", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-domain-conservatories-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Circoscrizioni sintetiche");
    const decedent = createSharedSubject(database, practice.id, {
      role: "decedent",
      displayName: "Defunto",
    });
    const beneficiary = createSharedSubject(database, practice.id, {
      role: "beneficiary",
      displayName: "Beneficiario",
    });
    const romeBuilding = createSharedAsset(database, practice.id, {
      kind: "building",
      displayName: "Fabbricato Roma",
      valueCents: 10_000_000n,
    });
    const milanBuilding = createSharedAsset(database, practice.id, {
      kind: "building",
      displayName: "Fabbricato Milano",
      valueCents: 10_000_000n,
    });

    let revision = saveCanonicalFields(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: 1,
      entityId: beneficiary.id,
      fields: [
        { fieldId: "quadro-ea.soggetto.tipo", value: "1" },
        { fieldId: "quadro-ea.soggetto.grado-parentela", value: "10" },
      ],
      confirmOfficialRules: true,
    }).revision;
    revision = saveCanonicalField(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: revision,
      fieldId: "frontespizio.defunto.data-decesso",
      value: "01012025",
      entityId: decedent.id,
    }).revision;
    revision = saveCanonicalFields(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: revision,
      entityId: romeBuilding.id,
      fields: [
        { fieldId: BUILDING_VALUE_FIELD_ID, value: "100000" },
        { fieldId: BUILDING_PROVINCE_FIELD_ID, value: "RM" },
        { fieldId: BUILDING_MUNICIPALITY_FIELD_ID, value: "H501" },
        { fieldId: BUILDING_ADMINISTRATIVE_MUNICIPALITY_FIELD_ID, value: "H501" },
      ],
      confirmOfficialRules: true,
    }).revision;
    revision = saveCanonicalFields(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: revision,
      entityId: milanBuilding.id,
      fields: [
        { fieldId: BUILDING_VALUE_FIELD_ID, value: "100000" },
        { fieldId: BUILDING_PROVINCE_FIELD_ID, value: "MI" },
        { fieldId: BUILDING_MUNICIPALITY_FIELD_ID, value: "H501" },
        { fieldId: BUILDING_ADMINISTRATIVE_MUNICIPALITY_FIELD_ID, value: "F205" },
      ],
      confirmOfficialRules: true,
    }).revision;
    const scenario = saveDevolutionScenario(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      expectedRevision: revision,
      shares: [romeBuilding, milanBuilding].map((asset) => ({
        assetId: asset.id,
        beneficiaryId: beneficiary.id,
        numerator: 1n,
        denominator: 1n,
        rightCode: "1",
      })),
    });
    revision = confirmDevolutionScenario(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      scenarioId: scenario.id,
      expectedRevision: revision,
    });

    const calculation = runSuccessionCalculation(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
    });
    expect(calculation.issues.map(({ id }) => id)).not.toContain(
      "CALCULATION_CONSERVATORY_NOT_FOUND",
    );
    expect(calculation.declarationTaxes.jurisdictionCounts).toMatchObject({
      mortgage: 2,
      stampDuty: 2,
      mode: "automatic",
    });
    expect(calculation.declarationTaxes.officialFieldValues).toMatchObject({
      "xsd:/Fornitura/Dichiarazione/QuadroEF/SezioneIII_TassaIpotecaria/Circoscrizioni_Numero": "2",
      "xsd:/Fornitura/Dichiarazione/QuadroEF/SezioneIV_ImpostaBollo/Circoscrizioni_Numero": "2",
    });
    expect(getDeclaration(database, practice.declarationId, practice.id)?.revision).toBe(revision);

    const successive = createSuccessiveDeclaration(
      database,
      practice.id,
      practice.declarationId,
      "substitute-1",
    );
    const successiveScenario = saveDevolutionScenario(database, {
      practiceId: practice.id,
      declarationId: successive.id,
      expectedRevision: successive.revision,
      shares: [romeBuilding, milanBuilding].map((asset) => ({
        assetId: asset.id,
        beneficiaryId: beneficiary.id,
        numerator: 1n,
        denominator: 1n,
        rightCode: "1",
      })),
    });
    let successiveRevision = confirmDevolutionScenario(database, {
      practiceId: practice.id,
      declarationId: successive.id,
      scenarioId: successiveScenario.id,
      expectedRevision: successive.revision,
    });
    const missingProfessionalCounts = runSuccessionCalculation(database, {
      practiceId: practice.id,
      declarationId: successive.id,
    });
    expect(missingProfessionalCounts.issues.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        "CALCULATION_MORTGAGE_JURISDICTIONS_MISSING",
        "CALCULATION_STAMP_DUTY_JURISDICTIONS_MISSING",
      ]),
    );

    successiveRevision = saveCanonicalFields(database, {
      practiceId: practice.id,
      declarationId: successive.id,
      expectedRevision: successiveRevision,
      fields: [
        {
          fieldId:
            "xsd:/Fornitura/Dichiarazione/QuadroEF/SezioneIII_TassaIpotecaria/Circoscrizioni_Numero",
          value: "1",
        },
        {
          fieldId:
            "xsd:/Fornitura/Dichiarazione/QuadroEF/SezioneIV_ImpostaBollo/Circoscrizioni_Numero",
          value: "2",
        },
      ],
      confirmOfficialRules: true,
    }).revision;
    const updatedSuccessiveScenario = saveDevolutionScenario(database, {
      practiceId: practice.id,
      declarationId: successive.id,
      expectedRevision: successiveRevision,
      shares: [romeBuilding, milanBuilding].map((asset) => ({
        assetId: asset.id,
        beneficiaryId: beneficiary.id,
        numerator: 1n,
        denominator: 1n,
        rightCode: "1",
      })),
    });
    successiveRevision = confirmDevolutionScenario(database, {
      practiceId: practice.id,
      declarationId: successive.id,
      scenarioId: updatedSuccessiveScenario.id,
      expectedRevision: successiveRevision,
    });
    const professionalCounts = runSuccessionCalculation(database, {
      practiceId: practice.id,
      declarationId: successive.id,
    });
    expect(professionalCounts.issues.map(({ id }) => id)).not.toEqual(
      expect.arrayContaining([
        "CALCULATION_MORTGAGE_JURISDICTIONS_MISSING",
        "CALCULATION_STAMP_DUTY_JURISDICTIONS_MISSING",
      ]),
    );
    expect(professionalCounts.declarationTaxes.jurisdictionCounts).toMatchObject({
      mortgage: 1,
      stampDuty: 2,
      mortgageMaximum: 2,
      stampDutyMaximum: 2,
      mode: "professional-input",
    });
    expect(professionalCounts.declarationTaxes.officialFieldValues).not.toHaveProperty(
      "xsd:/Fornitura/Dichiarazione/QuadroEF/SezioneIII_TassaIpotecaria/Circoscrizioni_Numero",
    );
    expect(getDeclaration(database, successive.id, practice.id)?.revision).toBe(successiveRevision);
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
      kind: "securities",
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
