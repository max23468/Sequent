import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { documentProcessingInternals } from "../../src/lib/server/document-processing.ts";
import { processDocument } from "../../src/lib/server/document-processing.ts";
import { closeDatabase, openDatabase } from "../../src/lib/server/database.ts";
import { getDocument, getDocumentText } from "../../src/lib/server/documents.ts";
import { ingestDocument } from "../../src/lib/server/document-ingestion.ts";

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

  it("conserva una pagina TIFF multipagina priva di parole e richiede revisione", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sequent-empty-tiff-page-"));
    const database = openDatabase(directory);
    try {
      const document = await ingestDocument(
        database,
        new File([Buffer.from("II*\0fixture")], "scansione.tiff", { type: "image/tiff" }),
        { newPracticeTitle: "Pratica TIFF" },
        directory,
      );
      await processDocument(database, document.id, {
        dataDirectory: directory,
        runner: async (command, arguments_) => {
          if (command !== "tesseract") throw new Error(`UNEXPECTED_COMMAND:${command}`);
          if (arguments_.includes("--version")) return { stdout: "tesseract 5.5.1", stderr: "" };
          return {
            stdout:
              "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n" +
              "5\t1\t1\t1\t1\t1\t10\t20\t30\t12\t95\tPagina uno\n" +
              "1\t2\t0\t0\t0\t0\t0\t0\t100\t100\t-1\t\n",
            stderr: "",
          };
        },
      });

      expect(getDocument(database, document.id)).toMatchObject({
        status: "to_review",
        pageCount: 2,
      });
      expect(getDocumentText(database, document.id)).toEqual([
        expect.objectContaining({ pageNumber: 1, text: "Pagina uno" }),
        expect.objectContaining({ pageNumber: 2, text: "", confidence: null }),
      ]);
    } finally {
      closeDatabase(directory);
      await rm(directory, { recursive: true, force: true });
    }
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

  it("richiede OCR se anche una sola pagina PDF non contiene testo utile", () => {
    expect(
      documentProcessingInternals.needsPdfOcr(
        "Questa prima pagina contiene testo nativo sufficiente.\f   \f",
      ),
    ).toBe(true);
    expect(
      documentProcessingInternals.needsPdfOcr(
        "Questa prima pagina contiene testo nativo sufficiente.\fAnche la seconda pagina contiene testo nativo sufficiente.\f",
      ),
    ).toBe(false);
  });

  it("legge direttamente tutti i fogli XLSX anche fuori dall’area di stampa", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sequent-xlsx-structured-"));
    const path = join(directory, "fogli.xlsx");
    const archive = zipSync({
      "[Content_Types].xml": strToU8(
        '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
      ),
      "_rels/.rels": strToU8(
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      ),
      "xl/workbook.xml": strToU8(
        '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Visibile" sheetId="1" r:id="rId1"/><sheet name="Secondo" sheetId="2" r:id="rId2"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">Visibile!$A$1:$B$2</definedName></definedNames></workbook>',
      ),
      "xl/_rels/workbook.xml.rels": strToU8(
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>',
      ),
      "xl/worksheets/sheet1.xml": strToU8(
        '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Dentro area</t></is></c></row><row r="5"><c r="D5" t="inlineStr"><is><t>Fuori area</t></is></c></row></sheetData></worksheet>',
      ),
      "xl/worksheets/sheet2.xml": strToU8(
        '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="2"><c r="C2" t="inlineStr"><is><t>Secondo foglio</t></is></c></row></sheetData></worksheet>',
      ),
    });
    try {
      await writeFile(path, archive);
      const pages = await documentProcessingInternals.extractXlsxPages(path);
      expect(pages).toEqual([
        expect.objectContaining({
          pageNumber: 1,
          method: "structured",
          text: expect.stringContaining('D5 = "Fuori area"'),
        }),
        expect.objectContaining({
          pageNumber: 2,
          method: "structured",
          text: expect.stringContaining('C2 = "Secondo foglio"'),
        }),
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("blocca esplicitamente il testo estratto oltre il limite", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sequent-large-extracted-text-"));
    const path = join(directory, "testo.txt");
    try {
      await writeFile(path, Buffer.alloc(20 * 1024 * 1024 + 1, "a"));
      await expect(documentProcessingInternals.readTextLimited(path)).rejects.toThrow(
        "EXTRACTED_TEXT_TOO_LARGE",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
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

  it("non marca elaborato uno ZIP di cui ha letto soltanto l'indice", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sequent-archive-index-"));
    const database = openDatabase(directory);
    try {
      const document = await ingestDocument(
        database,
        new File([Buffer.from("PK\u0003\u0004fixture")], "documenti.zip", {
          type: "application/zip",
        }),
        { newPracticeTitle: "Pratica archivio" },
        directory,
      );
      await processDocument(database, document.id, {
        dataDirectory: directory,
        runner: async (command, arguments_) => {
          if (command !== "unzip") throw new Error(`UNEXPECTED_COMMAND:${command}`);
          if (arguments_.includes("-Z1"))
            return { stdout: "documento.pdf\nnota.txt\n", stderr: "" };
          if (arguments_.includes("-t"))
            return { stdout: "100 bytes uncompressed, 80 bytes compressed", stderr: "" };
          if (arguments_.includes("-v")) return { stdout: "UnZip 6.00", stderr: "" };
          throw new Error(`UNEXPECTED_ARGUMENTS:${arguments_.join(",")}`);
        },
      });

      expect(getDocument(database, document.id)).toMatchObject({
        status: "to_review",
        detectedFormat: "ZIP",
        pageCount: 0,
      });
      expect(getDocumentText(database, document.id)).toEqual([]);
      expect(
        database
          .prepare("SELECT kind FROM document_artifacts WHERE document_id = ?")
          .all(document.id),
      ).toContainEqual({ kind: "extracted_text" });
    } finally {
      closeDatabase(directory);
      await rm(directory, { recursive: true, force: true });
    }
  });
});
