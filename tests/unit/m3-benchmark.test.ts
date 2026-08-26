import { describe, expect, it } from "vitest";
import { evaluateM3Benchmark } from "../../src/lib/benchmark/m3.ts";

const corpusHash = "a".repeat(64);

describe("benchmark M3", () => {
  it("blocca una fonte inventata e un errore critico accettato", () => {
    const report = evaluateM3Benchmark({
      corpusId: "sintetico",
      corpusHash,
      cases: [
        {
          id: "caso-1",
          category: "pdf_native",
          knownDocumentIds: ["doc-1"],
          expected: [
            { key: "codice", value: "ABC", documentId: "doc-1", pageNumber: 1, critical: true },
          ],
          observed: [
            {
              key: "codice",
              value: "XYZ",
              documentId: "doc-fantasma",
              pageNumber: 1,
              sourceExcerpt: "inventato",
              reviewStatus: "confirmed",
            },
          ],
        },
      ],
    });
    expect(report.passedM3Safety).toBe(false);
    expect(report.inventedSources).toBe(1);
  });

  it("considera sicuro un valore errato lasciato da verificare", () => {
    const report = evaluateM3Benchmark({
      corpusId: "sintetico",
      corpusHash,
      cases: [
        {
          id: "caso-1",
          category: "pdf_scanned",
          knownDocumentIds: ["doc-1"],
          expected: [
            { key: "saldo", value: "100", documentId: "doc-1", pageNumber: 1, critical: true },
          ],
          observed: [
            {
              key: "saldo",
              value: "900",
              documentId: "doc-1",
              pageNumber: 1,
              sourceExcerpt: "Saldo",
              reviewStatus: "pending",
            },
          ],
        },
      ],
    });
    expect(report.passedM3Safety).toBe(true);
    expect(report.totals.correctly_pending).toBe(1);
  });
});
