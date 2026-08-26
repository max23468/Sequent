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
            {
              key: "codice",
              value: "ABC",
              documentId: "doc-1",
              pageNumber: 1,
              sourceText: "Codice ABC",
              critical: true,
            },
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
            {
              key: "saldo",
              value: "100",
              documentId: "doc-1",
              pageNumber: 1,
              sourceText: "Saldo 100",
              critical: true,
            },
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

  it("blocca fonte o pagina sbagliata anche quando il valore coincide", () => {
    const report = evaluateM3Benchmark({
      corpusId: "sintetico",
      corpusHash,
      cases: [
        {
          id: "caso-fonte",
          category: "pdf_native",
          knownDocumentIds: ["doc-1", "doc-2"],
          expected: [
            {
              key: "codice",
              value: "ABC",
              documentId: "doc-1",
              pageNumber: 1,
              sourceText: "Codice ABC",
              critical: true,
            },
          ],
          observed: [
            {
              key: "codice",
              value: "ABC",
              documentId: "doc-2",
              pageNumber: 7,
              sourceExcerpt: "ABC",
              reviewStatus: "confirmed",
            },
          ],
        },
      ],
    });
    expect(report.passedM3Safety).toBe(false);
    expect(report.criticalSilentErrors).toBe(1);
    expect(report.totals.wrong).toBe(1);
  });

  it("blocca un estratto inventato anche con valore, documento e pagina corretti", () => {
    const report = evaluateM3Benchmark({
      corpusId: "sintetico",
      corpusHash,
      cases: [
        {
          id: "caso-estratto",
          category: "pdf_native",
          knownDocumentIds: ["doc-1"],
          expected: [
            {
              key: "codice",
              value: "ABC",
              documentId: "doc-1",
              pageNumber: 1,
              sourceText: "Il codice presente nella fonte è ABC.",
              critical: true,
            },
          ],
          observed: [
            {
              key: "codice",
              value: "ABC",
              documentId: "doc-1",
              pageNumber: 1,
              sourceExcerpt: "Testo inventato ABC",
              reviewStatus: "confirmed",
            },
          ],
        },
      ],
    });
    expect(report.passedM3Safety).toBe(false);
    expect(report.inventedSources).toBe(1);
    expect(report.criticalSilentErrors).toBe(1);
  });

  it("blocca conflitti critici ignorati e risultati inventati", () => {
    const report = evaluateM3Benchmark({
      corpusId: "sintetico",
      corpusHash,
      cases: [
        {
          id: "caso-conflitto",
          category: "bank_certificate",
          knownDocumentIds: ["doc-1", "doc-2"],
          expected: [],
          observed: [
            {
              key: "campo-inventato",
              value: "XYZ",
              documentId: "doc-1",
              pageNumber: 1,
              sourceExcerpt: "XYZ",
              reviewStatus: "pending",
            },
          ],
          expectedConflicts: [{ key: "saldo", documentIds: ["doc-1", "doc-2"], critical: true }],
          observedConflicts: [],
        },
      ],
    });
    expect(report.passedM3Safety).toBe(false);
    expect(report.totals.invented).toBe(1);
    expect(report.totals.conflict_ignored).toBe(1);
    expect(report.criticalSilentErrors).toBe(1);
  });

  it("blocca un campo critico non trovato", () => {
    const report = evaluateM3Benchmark({
      corpusId: "sintetico",
      corpusHash,
      cases: [
        {
          id: "caso-mancante",
          category: "identity_document",
          knownDocumentIds: ["doc-1"],
          expected: [
            {
              key: "codice-fiscale",
              value: "RSSMRA00A00H501Z",
              documentId: "doc-1",
              pageNumber: 1,
              sourceText: "Codice fiscale RSSMRA00A00H501Z",
              critical: true,
            },
          ],
          observed: [],
        },
      ],
    });
    expect(report.passedM3Safety).toBe(false);
    expect(report.totals.not_found).toBe(1);
    expect(report.criticalSilentErrors).toBe(1);
  });

  it("non accetta un conflitto con la stessa fonte duplicata", () => {
    const report = evaluateM3Benchmark({
      corpusId: "sintetico",
      corpusHash,
      cases: [
        {
          id: "caso-fonti-duplicate",
          category: "bank_certificate",
          knownDocumentIds: ["doc-1", "doc-2"],
          expected: [],
          observed: [],
          expectedConflicts: [{ key: "saldo", documentIds: ["doc-1", "doc-2"], critical: true }],
          observedConflicts: [
            { key: "saldo", documentIds: ["doc-1", "doc-1"], reviewStatus: "pending" },
          ],
        },
      ],
    });
    expect(report.passedM3Safety).toBe(false);
    expect(report.totals.conflict_ignored).toBe(1);
  });
});
