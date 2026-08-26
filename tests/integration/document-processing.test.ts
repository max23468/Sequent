import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, openDatabase } from "../../src/lib/server/database.ts";
import { processDocument } from "../../src/lib/server/document-processing.ts";
import { ingestDocument } from "../../src/lib/server/document-ingestion.ts";
import { getDocument, getDocumentText } from "../../src/lib/server/documents.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    closeDatabase(directory);
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("elaborazione documentale", () => {
  it("estrae testo strutturato, conserva un derivato e aggiorna lo stato", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-processing-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const document = await ingestDocument(
      database,
      new File(["Prima pagina\fSeconda pagina"], "nota.txt", { type: "text/plain" }),
      { newPracticeTitle: "Pratica pipeline" },
      directory,
    );

    await processDocument(database, document.id, { dataDirectory: directory });

    expect(getDocument(database, document.id)).toMatchObject({
      status: "processed",
      detectedFormat: "TXT",
      pageCount: 2,
    });
    expect(getDocumentText(database, document.id)).toEqual([
      expect.objectContaining({ pageNumber: 1, text: "Prima pagina", method: "structured" }),
      expect.objectContaining({ pageNumber: 2, text: "Seconda pagina", method: "structured" }),
    ]);
    expect(
      database
        .prepare("SELECT kind, tool_name FROM document_artifacts WHERE document_id = ?")
        .all(document.id),
    ).toEqual([{ kind: "extracted_text", tool_name: "native" }]);
  });
});
