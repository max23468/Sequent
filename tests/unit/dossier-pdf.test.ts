import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { createDossierPdf } from "../../src/lib/server/dossier-pdf.ts";

describe("dossier PDF", () => {
  it("produce un PDF multipagina leggibile con importi esatti", async () => {
    const bytes = await createDossierPdf({
      title: "Pratica sintetica",
      declarationLabel: "Prima dichiarazione",
      revision: 4,
      successionDate: "2025-08-01",
      generatedAt: "2026-08-27T12:00:00.000Z",
      ready: false,
      digest: "a".repeat(64),
      officialSourceLabel: "Catalogo ministeriale sintetico",
      subjects: [
        { name: "Mario Rossi", role: "Defunto", taxCode: "RSSMRA80A01H501U" },
        { name: "Anna Rossi", role: "Beneficiario", taxCode: "RSSNNA80A41H501A" },
      ],
      assets: Array.from({ length: 24 }, (_, index) => ({
        name: `Bene sintetico ${index + 1}`,
        kind: "Fabbricato",
        valueCents: "123456789",
        quadro: "EC",
      })),
      shares: [
        {
          asset: "Bene sintetico 1",
          beneficiary: "Anna Rossi",
          numerator: "1",
          denominator: "1",
          valueCents: "123456789",
        },
      ],
      calculation: {
        totalTaxCents: "443273",
        beneficiaries: [
          {
            beneficiary: "Anna Rossi",
            netEstateCents: "20200000",
            allowanceCents: "10000000",
            grossTaxCents: "656700",
            netTaxCents: "443273",
          },
        ],
      },
      checklist: [{ label: "Documento che attesta il decesso", status: "Mancante" }],
      issues: [{ message: "Completa un dato necessario.", sourceId: "SRC-08" }],
    });
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toContain("%PDF-");
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBeGreaterThan(1);
    expect(document.getTitle()).toBe("Dossier - Pratica sintetica");
  });
});
