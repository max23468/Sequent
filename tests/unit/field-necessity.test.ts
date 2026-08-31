import { describe, expect, it } from "vitest";
import {
  fieldNecessityKind,
  fieldNecessityLabel,
  isConditionallyApplicableGroup,
  isMissingRequiredField,
} from "../../src/lib/field-necessity.ts";

function field(
  xsdPresence: "obbligatorio-nel-contesto" | "condizionale",
  effectiveMin: number,
  choiceGroup: string | null = null,
) {
  return {
    entryMode: "editable",
    operationalParity: {
      applicability: { xsdPresence, choiceGroup },
      cardinality: { effectiveMin },
    },
  };
}

describe("priorità dei campi della pratica", () => {
  it("distingue obblighi, alternative e dati pertinenti solo in certi casi", () => {
    expect(
      fieldNecessityLabel(
        fieldNecessityKind(field("obbligatorio-nel-contesto", 1), {
          readOnly: false,
          automatic: false,
          missing: false,
        }),
      ),
    ).toBe("Obbligatorio");
    expect(
      fieldNecessityLabel(
        fieldNecessityKind(field("obbligatorio-nel-contesto", 0, "choice-1"), {
          readOnly: false,
          automatic: false,
          missing: false,
        }),
      ),
    ).toBe("Alternativa");
    expect(
      fieldNecessityLabel(
        fieldNecessityKind(field("condizionale", 0), {
          readOnly: false,
          automatic: false,
          missing: false,
        }),
      ),
    ).toBe("Solo se pertinente");
  });

  it("riconosce i blocchi condizionali e apre la strada agli obblighi già attivi", () => {
    expect(
      isConditionallyApplicableGroup([
        field("obbligatorio-nel-contesto", 0),
        field("condizionale", 0),
      ]),
    ).toBe(true);
    expect(
      isConditionallyApplicableGroup([
        field("obbligatorio-nel-contesto", 1),
        field("condizionale", 0),
      ]),
    ).toBe(false);
    expect(
      isMissingRequiredField(
        {
          id: "REQUIRED_FIELD_MISSING:campo-1:entita-1",
          fieldId: "campo-1",
          entityId: "entita-1",
        },
        "campo-1",
        "entita-1",
        null,
      ),
    ).toBe(true);
  });
});
