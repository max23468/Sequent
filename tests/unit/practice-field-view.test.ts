import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { listQuadroFields } from "../../src/domain/official-catalog/catalog.ts";
import {
  buildOperationalParityMap,
  listOperationalAreaFields,
} from "../../src/domain/operational-parity.ts";
import { createPracticeFieldView } from "../../src/lib/server/practice-field-view.ts";
import {
  isSuccessioniOnLineFieldDisabled,
  successioniOnLineDisabledWhen,
} from "../../src/domain/successionionline-behavior.ts";

describe("DTO dei campi della pratica", () => {
  it("non invia al browser provenienza tecnica ed evidenze di sviluppo", () => {
    const source = listOperationalAreaFields("Patrimonio");
    const fields = source.map((field) => createPracticeFieldView(field, field.operationalParity));
    const serialized = JSON.stringify(fields);

    expect(serialized).not.toContain("requiredParityTests");
    expect(serialized).not.toContain("currentEvidence");
    expect(serialized).not.toContain("sourcePointer");
    expect(serialized).not.toContain("technicalPath");
    expect(serialized).not.toContain("successioniOnLineOrder");
    expect(serialized).not.toContain("successioniOnLineControlTypes");
    expect(serialized).not.toContain("successioniOnLineRadioGroup");
    expect(fields.every((field) => "successioniOnLineRadioPanel" in field)).toBe(true);
    expect(fields[0]?.operationalParity.applicability.xsdPresence).toBeDefined();
    expect(fields[0]?.operationalParity.cardinality.effectiveMin).toBeDefined();
    expect(Buffer.byteLength(serialized)).toBeLessThan(350_000);
  });

  it("limita il layout alla Vista Quadri e condivide i comportamenti con la Vista operativa", () => {
    const parityByFieldId = new Map(buildOperationalParityMap().map((row) => [row.fieldId, row]));
    const field = listQuadroFields("Frontespizio").find(
      ({ label }) => label === "Prima dichiarazione",
    );
    expect(field).toBeDefined();
    const view = createPracticeFieldView(field!, parityByFieldId.get(field!.canonicalId)!, true);

    expect(view.successioniOnLineOrder).toBe(0);
    expect(view.successioniOnLineSection).toBe("Tipo di dichiarazione");
    expect(view.successioniOnLinePage).toBe(1);
    expect(view.successioniOnLineControlTypes).toContain("CheckPannello");
    expect(view.successioniOnLineQuadroReadOnly).toBe(false);
    expect(view.successioniOnLineRadioGroup).toBeNull();
    expect(view.successioniOnLineDisabledWhen).toEqual([]);
    expect(view.successioniOnLineAttachmentBucket).toBeNull();

    const radioField = listQuadroFields("EH").find(
      ({ canonicalId }) =>
        canonicalId ===
        "xsd:/Fornitura/Dichiarazione/QuadroEH/PrimoModulo/SezioneII_AgevPrimaCasa/Opzioni/FlagCambioResidenza",
    );
    expect(radioField).toBeDefined();
    const radioView = createPracticeFieldView(
      radioField!,
      parityByFieldId.get(radioField!.canonicalId)!,
      true,
    );
    expect(radioView.successioniOnLineControlTypes).toContain("SingleRadioGroup");
    expect(radioView.successioniOnLineRadioGroup).toBe("EH:radio-EH001");

    const conditionalFieldId =
      "xsd:/Fornitura/Dichiarazione/QuadroEH/PrimoModulo/SezioneI_DichSost/DatiDefunto/Decesso/DataDecesso";
    const conditions = successioniOnLineDisabledWhen(conditionalFieldId);
    expect(conditions).toHaveLength(2);
    expect(isSuccessioniOnLineFieldDisabled(conditionalFieldId, () => "1")).toBe(true);
    expect(isSuccessioniOnLineFieldDisabled(conditionalFieldId, () => "0")).toBe(false);

    const egField = listQuadroFields("EG").find(({ label }) => label === "Testamento");
    expect(egField).toBeDefined();
    const egView = createPracticeFieldView(
      egField!,
      parityByFieldId.get(egField!.canonicalId)!,
      true,
    );
    expect(egView.successioniOnLineAttachmentBucket?.id).toBe("EG2");
  });

  it("allinea Frontespizio ed EA tra Vista Quadri e Vista operativa", () => {
    const parityByFieldId = new Map(buildOperationalParityMap().map((row) => [row.fieldId, row]));
    const fields = ["Frontespizio", "EA"].flatMap((quadro) =>
      listQuadroFields(quadro as "Frontespizio" | "EA"),
    );

    for (const field of fields) {
      const parity = parityByFieldId.get(field.canonicalId)!;
      const quadri = createPracticeFieldView(field, parity, true);
      const operational = createPracticeFieldView(field, parity);
      expect(
        {
          control: operational.control,
          options: operational.options,
          choiceSource: operational.choiceSource,
          choiceProvinceFieldId: operational.choiceProvinceFieldId,
          appliesToDeclarationKinds: operational.appliesToDeclarationKinds,
          entryMode: operational.entryMode,
          derivedFrom: operational.derivedFrom,
          radioPanel: operational.successioniOnLineRadioPanel,
          operationalParity: operational.operationalParity,
        },
        field.canonicalId,
      ).toEqual({
        control: quadri.control,
        options: quadri.options,
        choiceSource: quadri.choiceSource,
        choiceProvinceFieldId: quadri.choiceProvinceFieldId,
        appliesToDeclarationKinds: quadri.appliesToDeclarationKinds,
        entryMode: quadri.entryMode,
        derivedFrom: quadri.derivedFrom,
        radioPanel: quadri.successioniOnLineRadioPanel,
        operationalParity: quadri.operationalParity,
      });
    }

    const sexFields = fields.filter(({ label }) => label === "Sesso");
    expect(sexFields).toHaveLength(3);
    expect(
      sexFields.every(
        (field) =>
          createPracticeFieldView(field, parityByFieldId.get(field.canonicalId)!)
            .successioniOnLineRadioPanel,
      ),
    ).toBe(true);

    const outputFields = fields.filter(
      (field) =>
        createPracticeFieldView(field, parityByFieldId.get(field.canonicalId)!, true)
          .successioniOnLineQuadroReadOnly,
    );
    expect(outputFields).toHaveLength(10);
    expect(
      outputFields.filter(
        (field) => parityByFieldId.get(field.canonicalId)?.handling === "inserito",
      ),
    ).toHaveLength(7);
    expect(
      outputFields.filter(
        (field) => field.label.includes("Codice") || field.label.includes("Numero"),
      ).length,
    ).toBeGreaterThan(0);
  });

  it("porta nel controllo il significato ufficiale dei codici numerici", () => {
    const fields = listQuadroFields("Frontespizio");
    const presenterRole = fields.find(({ visibleNumber }) => visibleNumber === "43");
    const presenterSex = fields.find(({ visibleNumber }) => visibleNumber === "47");
    const presenterBirthProvince = fields.find(({ visibleNumber }) => visibleNumber === "49");
    const transmissionCommitment = fields.find(({ visibleNumber }) => visibleNumber === "81");
    const printLanguage = fields.find(({ visibleNumber }) => visibleNumber === "106");

    expect(presenterRole?.options).toContainEqual({
      value: "7",
      label: "Esecutore testamentario",
    });
    expect(transmissionCommitment?.options).toContainEqual({
      value: "2",
      label: "Dichiarazione predisposta da chi effettua l’invio",
    });
    expect(presenterSex?.options).toEqual([
      { value: "M", label: "Maschile" },
      { value: "F", label: "Femminile" },
    ]);
    expect(presenterBirthProvince?.options).toContainEqual({
      value: "EE",
      label: "EE — Paese estero",
    });
    expect(printLanguage?.options).toEqual([
      { value: "1", label: "Tedesco" },
      { value: "2", label: "Sloveno" },
    ]);
  });

  it("mantiene i predicate client separati dal catalogo ministeriale", () => {
    for (const component of [
      "src/lib/components/OfficialFieldControl.svelte",
      "src/lib/components/OfficialFieldGroup.svelte",
      "src/lib/components/OperationalFieldGroup.svelte",
    ]) {
      expect(readFileSync(component, "utf8")).toContain("operational-parity-shared");
      expect(readFileSync(component, "utf8")).not.toMatch(/operational-parity["']/);
    }
  });
});
