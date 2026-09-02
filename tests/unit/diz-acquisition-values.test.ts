import { describe, expect, it } from "vitest";
import { normalizeImportedDizValue } from "../../src/lib/server/diz-acquisition.ts";

describe("valori importati dai DIZ", () => {
  it("non materializza lo zero usato da SuccessioniOnLine per una data facoltativa assente", () => {
    expect(
      normalizeImportedDizValue(
        "xsd:/Fornitura/Dichiarazione/Frontespizio/Presentatore/DecorrenzaTerminePresentazione",
        "0",
      ),
    ).toBe("");
  });

  it("non nasconde uno zero in un campo che non è una data facoltativa", () => {
    expect(normalizeImportedDizValue("quadro-ea.soggetto.rinuncia", "0")).toBe("0");
  });
});
