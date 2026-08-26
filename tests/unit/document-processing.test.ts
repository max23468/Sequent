import { describe, expect, it } from "vitest";
import { documentProcessingInternals } from "../../src/lib/server/document-processing.ts";

describe("pipeline documentale", () => {
  it("riconosce il contenuto PDF senza fidarsi dell'estensione", () => {
    expect(
      documentProcessingInternals.detectFormat(
        "allegato.txt",
        "text/plain",
        Buffer.from("%PDF-1.7"),
      ),
    ).toMatchObject({ format: "PDF", kind: "pdf", extension: ".pdf" });
  });

  it("calcola coordinate e confidence OCR dal TSV", () => {
    const result = documentProcessingInternals.parseTsv(
      "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t10\t20\t30\t12\t92.5\tMario\n5\t1\t1\t1\t1\t2\t45\t20\t40\t12\t87.5\tRossi\n",
    );
    expect(result.text).toBe("Mario Rossi");
    expect(result.confidence).toBeCloseTo(0.9);
    expect(result.coordinates).toEqual([
      expect.objectContaining({ text: "Mario", x: 10, y: 20, confidence: 0.925 }),
      expect.objectContaining({ text: "Rossi", x: 45, y: 20, confidence: 0.875 }),
    ]);
  });

  it("conserva le coordinate native delle parole PDF", () => {
    const pages = documentProcessingInternals.parsePdfBbox(
      '<html><body><page width="600" height="800"><word xMin="10" yMin="20" xMax="50" yMax="32">Mario</word><word xMin="55" yMin="20" xMax="90" yMax="32">Rossi</word></page></body></html>',
      "native",
    );
    expect(pages).toEqual([
      expect.objectContaining({
        pageNumber: 1,
        text: "Mario Rossi",
        confidence: 1,
        coordinates: [
          { text: "Mario", x: 10, y: 20, width: 40, height: 12 },
          { text: "Rossi", x: 55, y: 20, width: 35, height: 12 },
        ],
      }),
    ]);
  });

  it("blocca traversal e rapporti di compressione anomali negli archivi", async () => {
    await expect(
      documentProcessingInternals.inspectArchive("fixture.zip", async (_command, arguments_) => ({
        stdout: arguments_.includes("-Z1")
          ? "../segreto.txt\n"
          : "1 bytes uncompressed, 1 bytes compressed",
        stderr: "",
      })),
    ).rejects.toThrow("ARCHIVE_PATH_TRAVERSAL");
    await expect(
      documentProcessingInternals.inspectArchive("fixture.zip", async (_command, arguments_) => ({
        stdout: arguments_.includes("-Z1")
          ? "documento.txt\n"
          : "209715200 bytes uncompressed, 1024 bytes compressed",
        stderr: "",
      })),
    ).rejects.toThrow("ARCHIVE_COMPRESSION_RATIO_LIMIT");
  });
});
