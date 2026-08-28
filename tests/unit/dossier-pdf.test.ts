import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { createDossierPdf } from "../../src/lib/server/dossier-pdf.ts";

describe("dossier PDF", () => {
  it("produce un PDF multipagina leggibile con importi esatti", async () => {
    const bytes = await createDossierPdf({
      title: "Pratica Łukasz Živković – €",
      declarationLabel: "Prima dichiarazione",
      revision: 4,
      successionDate: "2025-08-01",
      generatedAt: "2026-08-27T12:00:00.000Z",
      ready: false,
      digest: "a".repeat(64),
      officialSourceLabel: "Catalogo ministeriale sintetico",
      qualification: {
        quadriPresent: ["Frontespizio", "EA", "EC", "EF"],
        officialControl: { name: "SUC13", version: "2.3.1", blockingDiagnostics: 0 },
        attachments: {
          files: 2,
          totalBytes: 128000,
          formats: ["PDF/A-1b", "TIFF-G4"],
          motivatedExceptions: 0,
        },
      },
      subjects: [
        { name: "Łukasz Živković", role: "Defunto", taxCode: "RSSMRA80A01H501U" },
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
        taxSummary: {
          totalAssetsCents: "20250000",
          totalLiabilitiesCents: "50000",
          netEstateCents: "20200000",
          mortgageTaxCents: "20000",
          cadastralTaxCents: "20000",
          relatedTaxesCents: "22100",
          successionTaxCents: "443273",
          penaltiesAndInterestCents: "0",
          totalAtSubmissionCents: "505373",
        },
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
    // I caratteri completi evitano spazi anomali e lettere mancanti nei lettori PDF.
    expect(bytes.byteLength).toBeGreaterThan(400_000);
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBeGreaterThan(1);
    expect(document.getTitle()).toBe("Dossier - Pratica Łukasz Živković – €");
  });
});
