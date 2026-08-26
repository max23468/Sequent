import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  analyzePracticeWithCodex,
  type CodexAnalysisAdapter,
} from "../../src/lib/server/codex-analysis.ts";
import { closeDatabase, openDatabase } from "../../src/lib/server/database.ts";
import { processDocument } from "../../src/lib/server/document-processing.ts";
import { listReviewItems } from "../../src/lib/server/documents.ts";
import { ingestDocument } from "../../src/lib/server/document-ingestion.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    closeDatabase(directory);
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("analisi pratica con Codex", () => {
  it("valida l'output e lascia ogni proposta in revisione", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-codex-analysis-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const document = await ingestDocument(
      database,
      new File(["Documento sintetico: riferimento pratica AB-12."], "nota.txt", {
        type: "text/plain",
      }),
      { newPracticeTitle: "Pratica Codex" },
      directory,
    );
    await processDocument(database, document.id, { dataDirectory: directory });
    const adapter: CodexAnalysisAdapter = {
      async run(request) {
        expect(request.input[0]).toMatchObject({ type: "text" });
        return {
          threadId: "thread-sintetico",
          usage: null,
          finalResponse: JSON.stringify({
            summary: "Analisi sintetica",
            proposals: [
              {
                label: "Riferimento pratica",
                value: "AB-12",
                documentId: document.id,
                pageNumber: 1,
                excerpt: "riferimento pratica AB-12",
                confidence: 0.97,
                alternatives: [],
              },
            ],
            conflicts: [],
          }),
        };
      },
    };

    const result = await analyzePracticeWithCodex(database, document.practiceId, {
      dataDirectory: directory,
      adapter,
    });

    expect(result).toMatchObject({ proposals: 1, conflicts: 0 });
    expect(listReviewItems(database, document.practiceId)).toEqual([
      expect.objectContaining({
        label: "Riferimento pratica",
        proposedValue: "AB-12",
        method: "codex",
        status: "pending",
        critical: false,
      }),
    ]);
    expect(
      database
        .prepare("SELECT thread_id FROM codex_threads WHERE practice_id = ?")
        .get(document.practiceId),
    ).toEqual({ thread_id: "thread-sintetico" });
  });

  it.each([
    {
      name: "documento estraneo",
      proposal: { documentId: "documento-estraneo" },
      expectedError: "CODEX_UNKNOWN_DOCUMENT",
    },
    {
      name: "pagina inesistente",
      proposal: { pageNumber: 999 },
      expectedError: "CODEX_UNKNOWN_PAGE",
    },
    {
      name: "estratto non presente",
      proposal: { excerpt: "contenuto inventato" },
      expectedError: "CODEX_UNSUPPORTED_EXCERPT",
    },
    {
      name: "pagina nulla",
      proposal: { pageNumber: null },
      expectedError: "Invalid input",
    },
    {
      name: "estratto nullo",
      proposal: { excerpt: null },
      expectedError: "Invalid input",
    },
    {
      name: "estratto vuoto dopo la normalizzazione",
      proposal: { excerpt: "   " },
      expectedError: "Too small",
    },
  ])("rifiuta atomicamente una proposta con $name", async ({ proposal, expectedError }) => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-codex-evidence-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const document = await ingestDocument(
      database,
      new File(["Documento sintetico: riferimento pratica AB-12."], "nota.txt", {
        type: "text/plain",
      }),
      { newPracticeTitle: "Pratica Codex" },
      directory,
    );
    await processDocument(database, document.id, { dataDirectory: directory });
    const adapter: CodexAnalysisAdapter = {
      async run() {
        return {
          threadId: "thread-non-valido",
          usage: null,
          finalResponse: JSON.stringify({
            summary: "Analisi sintetica",
            proposals: [
              {
                label: "Riferimento pratica",
                value: "AB-12",
                documentId: document.id,
                pageNumber: 1,
                excerpt: "riferimento pratica AB-12",
                confidence: 0.97,
                alternatives: [],
                ...proposal,
              },
            ],
            conflicts: [],
          }),
        };
      },
    };

    await expect(
      analyzePracticeWithCodex(database, document.practiceId, {
        dataDirectory: directory,
        adapter,
      }),
    ).rejects.toThrow(expectedError);
    expect(listReviewItems(database, document.practiceId)).toEqual([]);
    expect(
      database
        .prepare("SELECT thread_id FROM codex_threads WHERE practice_id = ?")
        .get(document.practiceId),
    ).toBeUndefined();
    expect(
      database
        .prepare("SELECT status FROM codex_runs WHERE practice_id = ?")
        .get(document.practiceId),
    ).toEqual({ status: "failed" });
  });

  it("rifiuta un conflitto che cita anche un documento estraneo", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-codex-conflict-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const document = await ingestDocument(
      database,
      new File(["Documento sintetico: riferimento pratica AB-12."], "nota.txt", {
        type: "text/plain",
      }),
      { newPracticeTitle: "Pratica Codex" },
      directory,
    );
    await processDocument(database, document.id, { dataDirectory: directory });
    const adapter: CodexAnalysisAdapter = {
      async run() {
        return {
          threadId: "thread-conflitto-non-valido",
          usage: null,
          finalResponse: JSON.stringify({
            summary: "Analisi sintetica",
            proposals: [],
            conflicts: [
              {
                label: "Riferimento pratica",
                values: ["AB-12", "AB-13"],
                documentIds: [document.id, "documento-estraneo"],
                explanation: "Valori discordanti",
              },
            ],
          }),
        };
      },
    };

    await expect(
      analyzePracticeWithCodex(database, document.practiceId, {
        dataDirectory: directory,
        adapter,
      }),
    ).rejects.toThrow("CODEX_UNKNOWN_DOCUMENT");
    expect(listReviewItems(database, document.practiceId)).toEqual([]);
  });
});
