import { describe, expect, it } from "vitest";
import {
  SEQUENT_PRODUCT_IDENTIFIER,
  addSnapshotAutomaticOfficialFieldValues,
} from "../../src/domain/automatic-official-fields.ts";
import type { DeclarationSnapshot } from "../../src/domain/declaration.ts";
import { listQuadroFields, type QuadroId } from "../../src/domain/official-catalog/catalog.ts";

const COMPILED_QUADRI = [
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
] as const satisfies readonly QuadroId[];

function snapshotWith(fieldId: string, value: string): DeclarationSnapshot {
  return {
    fields: {
      synthetic: {
        fieldId,
        entityId: null,
        occurrenceId: null,
        value,
      },
    },
  } as unknown as DeclarationSnapshot;
}

describe("campi ufficiali automatici dello snapshot", () => {
  it.each(COMPILED_QUADRI)("deriva Casella%s dalla presenza del Quadro", (quadro) => {
    const fieldId = listQuadroFields(quadro).find(
      (field) => field.visibleFieldId !== null,
    )!.canonicalId;
    const values = addSnapshotAutomaticOfficialFieldValues(snapshotWith(fieldId, "1"), {});
    for (const candidate of COMPILED_QUADRI)
      expect(
        values[`xsd:/Fornitura/Dichiarazione/Frontespizio/FirmaModello/Casella${candidate}`],
      ).toBe(candidate === quadro ? "1" : "0");
    expect(values["xsd:/Fornitura/Dichiarazione/Frontespizio/IdentificativoProdSoftware"]).toBe(
      SEQUENT_PRODUCT_IDENTIFIER,
    );
  });

  it("ignora valori vuoti e considera anche i risultati automatici del Quadro", () => {
    const eaFieldId = listQuadroFields("EA")[0]!.canonicalId;
    const eeFieldId = listQuadroFields("EE")[0]!.canonicalId;
    const values = addSnapshotAutomaticOfficialFieldValues(snapshotWith(eaFieldId, ""), {
      [eeFieldId]: "0",
    });
    expect(values["xsd:/Fornitura/Dichiarazione/Frontespizio/FirmaModello/CasellaEA"]).toBe("0");
    expect(values["xsd:/Fornitura/Dichiarazione/Frontespizio/FirmaModello/CasellaEE"]).toBe("1");
  });
});
