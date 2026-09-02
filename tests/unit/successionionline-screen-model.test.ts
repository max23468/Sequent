import { describe, expect, it } from "vitest";

import { buildSuccessioniOnLineScreenModel } from "../../src/domain/successionionline-screen-model.ts";

function counts(values: readonly string[]): Record<string, number> {
  return Object.fromEntries(
    [...new Set(values)]
      .sort()
      .map((value) => [value, values.filter((candidate) => candidate === value).length]),
  );
}

describe("modello statico delle schermate SuccessioniOnLine", () => {
  it("combina schermata, XSD, editabilità e dipendenze senza ridurle alla sola etichetta", () => {
    const fields = buildSuccessioniOnLineScreenModel();
    expect(fields).toHaveLength(715);
    expect(new Set(fields.map(({ fieldId }) => fieldId))).toHaveLength(715);
    expect(counts(fields.map(({ screen }) => screen.status))).toEqual({
      "direct-control": 580,
      "eg-attachment-control": 11,
      "not-observed-in-script": 124,
    });
    expect(counts(fields.map(({ behavior }) => behavior.inputState))).toEqual({
      "context-dependent": 2,
      editable: 644,
      "read-only-automatic": 56,
      "read-only-derived": 5,
      "read-only-office": 8,
    });
    expect(counts(fields.map(({ specification }) => specification.presence))).toEqual({
      "choice-dependent": 22,
      optional: 304,
      required: 21,
      "required-when-context-active": 368,
    });
    expect(fields.filter(({ behavior }) => behavior.disabledWhen.length > 0)).toHaveLength(36);
    expect(counts(fields.map(({ alignment }) => alignment.screenComparison))).toEqual({
      "different-input-workflow": 109,
      "different-readonly-workflow": 5,
      "direct-input-consistent": 436,
      "direct-readonly-consistent": 41,
      "not-observed-in-script": 124,
    });
    expect(counts(fields.map(({ alignment }) => alignment.review))).toEqual({
      "direct-equivalent": 477,
      "qualified-different-workflow": 114,
      "qualified-noninteractive": 23,
      "qualified-offscreen-input": 101,
    });
    expect(
      fields.every(
        ({ specification, evidence }) =>
          specification.technicalType.length > 0 && evidence.technicalSourcePointer.length > 0,
      ),
    ).toBe(true);
  });

  it("chiude Frontespizio ed EA senza nascondere i workflow ufficiali diversi", () => {
    const fields = buildSuccessioniOnLineScreenModel();
    const frontespizio = fields.filter(({ quadro }) => quadro === "Frontespizio");
    const ea = fields.filter(({ quadro }) => quadro === "EA");

    expect(counts(frontespizio.map(({ alignment }) => alignment.review))).toEqual({
      "direct-equivalent": 47,
      "qualified-different-workflow": 11,
      "qualified-noninteractive": 23,
      "qualified-offscreen-input": 5,
    });
    expect(counts(ea.map(({ alignment }) => alignment.review))).toEqual({
      "direct-equivalent": 20,
      "qualified-different-workflow": 1,
    });
    expect(
      [...frontespizio, ...ea].every(
        ({ alignment }) => alignment.review !== "unresolved" && alignment.reviewBasis.length > 0,
      ),
    ).toBe(true);
  });

  it("il quadro EG conserva lista allegati, contatore, specifica e provenienza", () => {
    const eg = buildSuccessioniOnLineScreenModel().filter(
      ({ screen }) => screen.status === "eg-attachment-control",
    );
    expect(eg).toHaveLength(11);
    expect(
      eg.every(
        ({ recordCode, screen, evidence }) =>
          recordCode?.match(/^EG\d{6}$/u) &&
          screen.control === "attachment-list" &&
          screen.commands.includes("ListaFileSemaforo") &&
          screen.commands.includes("CampoInput") &&
          evidence.screenSourcePointers.length >= 2,
      ),
    ).toBe(true);
  });

  it("evidenzia i campi editabili in Sequent ma chiusi o prodotti altrove nella schermata Java", () => {
    const workflowDifferences = buildSuccessioniOnLineScreenModel().filter(
      ({ alignment }) => alignment.screenComparison === "different-input-workflow",
    );
    expect(workflowDifferences).toHaveLength(109);
    expect(counts(workflowDifferences.map(({ screen }) => screen.control))).toEqual({
      output: 88,
      "print-only": 21,
    });
  });
});
