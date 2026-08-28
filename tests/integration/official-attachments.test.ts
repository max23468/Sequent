import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { closeDatabase, openDatabase } from "../../src/lib/server/database.ts";
import { ingestDocument } from "../../src/lib/server/document-ingestion.ts";
import {
  listOfficialAttachments,
  prepareOfficialAttachment,
} from "../../src/lib/server/official-attachments.ts";
import { createPractice } from "../../src/lib/server/practices.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    closeDatabase(directory);
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("preparazione degli allegati ufficiali", () => {
  test("crea e valida realmente un PDF/A-1b senza modificare l’originale", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-official-attachment-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Allegato sintetico");
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]);
    page.drawText("Documento sintetico per la dichiarazione", {
      x: 50,
      y: 780,
      size: 14,
      font: await pdf.embedFont(StandardFonts.Helvetica),
    });
    const original = Buffer.from(await pdf.save());
    const originalHash = createHash("sha256").update(original).digest("hex");
    const document = await ingestDocument(
      database,
      new File([original], "documento-sintetico.pdf", { type: "application/pdf" }),
      { practiceId: practice.id },
      directory,
    );

    const prepared = await prepareOfficialAttachment(database, {
      practiceId: practice.id,
      documentId: document.id,
      dataDirectory: directory,
    });

    expect(prepared).toHaveLength(1);
    expect(prepared[0]).toMatchObject({
      format: "PDF/A-1b",
      originalName: "documento-sintetico.pdf",
    });
    expect(prepared[0]!.byteSize).toBeLessThanOrEqual(5 * 1024 * 1024);
    expect(prepared[0]!.validation).toMatchObject({
      profile: "PDF/A-1b",
      structuralCheck: "qpdf",
      outputIntent: "sRGB",
    });
    expect(listOfficialAttachments(database, practice.id)).toHaveLength(1);
    expect(
      createHash("sha256")
        .update(readFileSync(join(directory, document.blobPath)))
        .digest("hex"),
    ).toBe(originalHash);
  }, 60_000);

  test("converte e valida realmente un’immagine in TIFF Group 4 senza modificare l’originale", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-official-image-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Immagine sintetica");
    const original = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const originalHash = createHash("sha256").update(original).digest("hex");
    const document = await ingestDocument(
      database,
      new File([original], "immagine-sintetica.png", { type: "image/png" }),
      { practiceId: practice.id },
      directory,
    );

    const prepared = await prepareOfficialAttachment(database, {
      practiceId: practice.id,
      documentId: document.id,
      dataDirectory: directory,
    });

    expect(prepared).toHaveLength(1);
    expect(prepared[0]).toMatchObject({
      format: "TIFF-G4",
      originalName: "immagine-sintetica.png",
      validation: {
        profile: "TIFF-G4",
        bitDepth: 1,
        resolution: [300, 300],
      },
    });
    expect(prepared[0]!.byteSize).toBeLessThanOrEqual(5 * 1024 * 1024);
    expect(
      createHash("sha256")
        .update(readFileSync(join(directory, document.blobPath)))
        .digest("hex"),
    ).toBe(originalHash);
  }, 60_000);
});
