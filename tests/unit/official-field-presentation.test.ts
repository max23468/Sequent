import { describe, expect, it } from "vitest";
import {
  formatOfficialChoiceLabel,
  formatOfficialDateValue,
  normalizeOfficialDateValue,
} from "../../src/lib/official-field-presentation.ts";

describe("presentazione dei campi ufficiali", () => {
  it("mostra i separatori delle date senza cambiare il valore canonico", () => {
    expect(formatOfficialDateValue("22081981")).toBe("22/08/1981");
    expect(formatOfficialDateValue("2208")).toBe("22/08");
    expect(normalizeOfficialDateValue("22/08/1981")).toBe("22081981");
  });

  it("tratta lo zero segnaposto di SuccessioniOnLine come data non indicata", () => {
    expect(formatOfficialDateValue("0")).toBe("");
    expect(normalizeOfficialDateValue("00000000")).toBe("");
  });

  it("affianca il significato ai codici ufficiali", () => {
    expect(formatOfficialChoiceLabel({ value: "2", label: "Legatario" })).toBe("2 — Legatario");
    expect(formatOfficialChoiceLabel({ value: "2", label: "2 — Legatario" })).toBe("2 — Legatario");
  });
});
