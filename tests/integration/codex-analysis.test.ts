import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, rmSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  analyzePracticeWithCodex,
  hasCodexThread,
  listCodexRuns,
  resetCodexThread,
  type CodexAnalysisAdapter,
} from "../../src/lib/server/codex-analysis.ts";
import { resolveBlobPath } from "../../src/lib/server/blob-store.ts";
import { closeDatabase, openDatabase } from "../../src/lib/server/database.ts";
import { processDocument } from "../../src/lib/server/document-processing.ts";
import { decideReviewItem, listReviewItems } from "../../src/lib/server/documents.ts";
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
        expect(request.input[0]).toMatchObject({
          text: expect.stringContaining(
            "Apri manifest.json e leggi per intero ogni file indicato da extractedTextPath",
          ),
        });
        expect(statSync(request.workingDirectory).mode & 0o777).toBe(0o755);
        expect(statSync(join(request.workingDirectory, "manifest.json")).mode & 0o777).toBe(0o644);
        const documentDirectory = join(request.workingDirectory, "documents");
        expect(statSync(documentDirectory).mode & 0o777).toBe(0o755);
        expect(
          readdirSync(documentDirectory).map(
            (name) => statSync(join(documentDirectory, name)).mode & 0o777,
          ),
        ).toEqual([0o644, 0o644]);
        return {
          threadId: "thread-sintetico",
          usage: null,
          finalResponse: JSON.stringify({
            summary: "Analisi sintetica",
            proposals: [
              {
                subjectId: "practice.reference",
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
    const progress: number[] = [];

    const result = await analyzePracticeWithCodex(database, document.practiceId, {
      dataDirectory: directory,
      adapter,
      onProgress: (value) => progress.push(value),
    });

    expect(result).toMatchObject({ proposals: 1, conflicts: 0 });
    expect(progress).toEqual([5, 12, 15, 90, 95]);
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
    expect(hasCodexThread(database, document.practiceId)).toBe(true);
    expect(listCodexRuns(database, document.practiceId)).toEqual([
      expect.objectContaining({
        status: "completed",
        summary: "Analisi sintetica",
        proposalCount: 1,
        conflictCount: 0,
      }),
    ]);
    expect(resetCodexThread(database, document.practiceId)).toBe(true);
    expect(hasCodexThread(database, document.practiceId)).toBe(false);
    expect(listCodexRuns(database, document.practiceId)).toHaveLength(1);
  });

  it("conserva proposte omonime riferite a soggetti distinti", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-codex-distinct-subjects-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const document = await ingestDocument(
      database,
      new File(["Mario: codice fiscale AAA. Lucia: codice fiscale BBB."], "soggetti.txt", {
        type: "text/plain",
      }),
      { newPracticeTitle: "Pratica soggetti distinti" },
      directory,
    );
    await processDocument(database, document.id, { dataDirectory: directory });
    const adapter: CodexAnalysisAdapter = {
      async run() {
        return {
          threadId: "thread-soggetti-distinti",
          usage: null,
          finalResponse: JSON.stringify({
            summary: "Due soggetti",
            proposals: [
              {
                subjectId: "person.mario.tax-code",
                label: "Codice fiscale",
                value: "AAA",
                documentId: document.id,
                pageNumber: 1,
                excerpt: "Mario: codice fiscale AAA",
                confidence: 0.95,
                alternatives: [],
              },
              {
                subjectId: "person.lucia.tax-code",
                label: "Codice fiscale",
                value: "BBB",
                documentId: document.id,
                pageNumber: 1,
                excerpt: "Lucia: codice fiscale BBB",
                confidence: 0.95,
                alternatives: [],
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
    ).resolves.toMatchObject({ proposals: 2, conflicts: 0 });
    expect(listReviewItems(database, document.practiceId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Codice fiscale", proposedValue: "AAA" }),
        expect.objectContaining({ label: "Codice fiscale", proposedValue: "BBB" }),
      ]),
    );
    expect(listReviewItems(database, document.practiceId)).toHaveLength(2);
  });

  it.each(["proposal", "conflict"] as const)(
    "mantiene autorevole la decisione nella transizione da %s",
    async (initialKind) => {
      const directory = mkdtempSync(join(tmpdir(), `sequent-codex-${initialKind}-transition-`));
      directories.push(directory);
      const database = openDatabase(directory);
      const first = await ingestDocument(
        database,
        new File(["Il riferimento della pratica è AB-12."], "prima.txt", {
          type: "text/plain",
        }),
        { newPracticeTitle: "Pratica transizione Codex" },
        directory,
      );
      const second = await ingestDocument(
        database,
        new File(["Il riferimento della pratica è AB-13."], "seconda.txt", {
          type: "text/plain",
        }),
        { practiceId: first.practiceId },
        directory,
      );
      await processDocument(database, first.id, { dataDirectory: directory });
      await processDocument(database, second.id, { dataDirectory: directory });
      let invocation = 0;
      const adapter: CodexAnalysisAdapter = {
        async run() {
          const kind =
            invocation++ === 0 ? initialKind : initialKind === "proposal" ? "conflict" : "proposal";
          return {
            threadId: `thread-${initialKind}-transition`,
            usage: null,
            finalResponse: JSON.stringify({
              summary: "Transizione sintetica",
              proposals:
                kind === "proposal"
                  ? [
                      {
                        subjectId: "practice.reference",
                        label: "Riferimento pratica",
                        value: "AB-12",
                        documentId: first.id,
                        pageNumber: 1,
                        excerpt: "riferimento della pratica è AB-12",
                        confidence: 0.95,
                        alternatives: [],
                      },
                    ]
                  : [],
              conflicts:
                kind === "conflict"
                  ? [
                      {
                        subjectId: "practice.reference",
                        label: "Riferimento pratica",
                        sources: [
                          {
                            documentId: first.id,
                            pageNumber: 1,
                            excerpt: "riferimento della pratica è AB-12",
                            value: "AB-12",
                          },
                          {
                            documentId: second.id,
                            pageNumber: 1,
                            excerpt: "riferimento della pratica è AB-13",
                            value: "AB-13",
                          },
                        ],
                        explanation: "Valori discordanti",
                      },
                    ]
                  : [],
            }),
          };
        },
      };

      await analyzePracticeWithCodex(database, first.practiceId, {
        dataDirectory: directory,
        adapter,
      });
      const authoritative = listReviewItems(database, first.practiceId)[0];
      expect(authoritative).toBeDefined();
      expect(
        decideReviewItem(database, first.practiceId, authoritative!.id, {
          status: initialKind === "proposal" ? "confirmed" : "edited",
          value: "AB-12",
        }),
      ).toBe(true);

      await analyzePracticeWithCodex(database, first.practiceId, {
        dataDirectory: directory,
        adapter,
      });
      expect(
        database
          .prepare(
            `SELECT id, status, decided_value_json
             FROM review_items WHERE practice_id = ? AND subject_key = ?`,
          )
          .all(first.practiceId, authoritative!.subjectKey),
      ).toEqual([
        {
          id: authoritative!.id,
          status: initialKind === "proposal" ? "confirmed" : "edited",
          decided_value_json: '"AB-12"',
        },
      ]);
    },
  );

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
      name: "valore non presente",
      proposal: { value: "VALORE-INVENTATO" },
      expectedError: "CODEX_UNSUPPORTED_VALUE",
    },
    {
      name: "valore presente altrove nella pagina ma non nell’estratto",
      proposal: { excerpt: "Documento sintetico", value: "AB-12" },
      expectedError: "CODEX_UNSUPPORTED_VALUE",
    },
    {
      name: "alternativa non presente",
      proposal: { alternatives: ["ALTERNATIVA-INVENTATA"] },
      expectedError: "CODEX_UNSUPPORTED_ALTERNATIVE",
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
                subjectId: "practice.reference",
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
                subjectId: "practice.reference",
                label: "Riferimento pratica",
                sources: [
                  {
                    documentId: document.id,
                    pageNumber: 1,
                    excerpt: "riferimento pratica AB-12",
                    value: "AB-12",
                  },
                  {
                    documentId: "documento-estraneo",
                    pageNumber: 1,
                    excerpt: "riferimento pratica AB-13",
                    value: "AB-13",
                  },
                ],
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

  it("rifiuta un valore di conflitto non presente nella fonte citata", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-codex-conflict-value-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const document = await ingestDocument(
      database,
      new File(["Documento sintetico: riferimento pratica AB-12."], "nota.txt", {
        type: "text/plain",
      }),
      { newPracticeTitle: "Pratica conflitto inventato" },
      directory,
    );
    await processDocument(database, document.id, { dataDirectory: directory });
    const adapter: CodexAnalysisAdapter = {
      async run() {
        return {
          threadId: "thread-conflitto-inventato",
          usage: null,
          finalResponse: JSON.stringify({
            summary: "Conflitto sintetico",
            proposals: [],
            conflicts: [
              {
                subjectId: "practice.reference",
                label: "Riferimento pratica",
                sources: [
                  {
                    documentId: document.id,
                    pageNumber: 1,
                    excerpt: "riferimento pratica AB-12",
                    value: "VALORE-INVENTATO",
                  },
                  {
                    documentId: document.id,
                    pageNumber: 1,
                    excerpt: "riferimento pratica AB-12",
                    value: "AB-12",
                  },
                ],
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
    ).rejects.toThrow("CODEX_UNSUPPORTED_CONFLICT_VALUE");
    expect(listReviewItems(database, document.practiceId)).toEqual([]);
  });

  it("rifiuta valori di conflitto scambiati tra soggetti della stessa pagina", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-codex-swapped-conflict-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const document = await ingestDocument(
      database,
      new File(["Mario ha codice AAA. Luigi ha codice BBB."], "soggetti.txt", {
        type: "text/plain",
      }),
      { newPracticeTitle: "Pratica conflitto scambiato" },
      directory,
    );
    await processDocument(database, document.id, { dataDirectory: directory });
    const adapter: CodexAnalysisAdapter = {
      async run() {
        return {
          threadId: "thread-conflitto-scambiato",
          usage: null,
          finalResponse: JSON.stringify({
            summary: "Conflitto sintetico",
            proposals: [],
            conflicts: [
              {
                subjectId: "person.mario.tax-code",
                label: "Codice",
                sources: [
                  {
                    documentId: document.id,
                    pageNumber: 1,
                    excerpt: "Mario ha codice AAA",
                    value: "BBB",
                  },
                  {
                    documentId: document.id,
                    pageNumber: 1,
                    excerpt: "Luigi ha codice BBB",
                    value: "AAA",
                  },
                ],
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
    ).rejects.toThrow("CODEX_UNSUPPORTED_CONFLICT_VALUE");
    expect(listReviewItems(database, document.practiceId)).toEqual([]);
  });

  it("conserva pagina ed estratto di ogni fonte di un conflitto", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-codex-conflict-sources-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const first = await ingestDocument(
      database,
      new File(["Il riferimento della pratica è AB-12."], "prima.txt", { type: "text/plain" }),
      { newPracticeTitle: "Pratica conflitto Codex" },
      directory,
    );
    const second = await ingestDocument(
      database,
      new File(["Il riferimento della pratica è AB-13."], "seconda.txt", { type: "text/plain" }),
      { practiceId: first.practiceId },
      directory,
    );
    await processDocument(database, first.id, { dataDirectory: directory });
    await processDocument(database, second.id, { dataDirectory: directory });
    const adapter: CodexAnalysisAdapter = {
      async run() {
        return {
          threadId: "thread-conflitto-valido",
          usage: null,
          finalResponse: JSON.stringify({
            summary: "Due riferimenti discordanti",
            proposals: [],
            conflicts: [
              {
                subjectId: "practice.reference",
                label: "Riferimento pratica",
                sources: [
                  {
                    documentId: first.id,
                    pageNumber: 1,
                    excerpt: "riferimento della pratica è AB-12",
                    value: "AB-12",
                  },
                  {
                    documentId: second.id,
                    pageNumber: 1,
                    excerpt: "riferimento della pratica è AB-13",
                    value: "AB-13",
                  },
                ],
                explanation: "I documenti riportano riferimenti diversi.",
              },
            ],
          }),
        };
      },
    };

    await expect(
      analyzePracticeWithCodex(database, first.practiceId, {
        dataDirectory: directory,
        adapter,
      }),
    ).resolves.toMatchObject({ proposals: 0, conflicts: 1 });
    expect(listReviewItems(database, first.practiceId)).toEqual([
      expect.objectContaining({
        pageNumber: 1,
        alternatives: ["AB-12", "AB-13"],
        sourceRefs: [
          expect.objectContaining({
            documentId: first.id,
            pageNumber: 1,
            excerpt: "riferimento della pratica è AB-12",
          }),
          expect.objectContaining({
            documentId: second.id,
            pageNumber: 1,
            excerpt: "riferimento della pratica è AB-13",
          }),
        ],
      }),
    ]);
  });

  it("marca come annullata una run Codex interrotta dall'utente", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-codex-cancel-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const document = await ingestDocument(
      database,
      new File(["Documento sintetico da analizzare."], "nota.txt", { type: "text/plain" }),
      { newPracticeTitle: "Pratica Codex annullata" },
      directory,
    );
    await processDocument(database, document.id, { dataDirectory: directory });
    const controller = new AbortController();
    const adapter: CodexAnalysisAdapter = {
      async run(request) {
        if (request.signal?.aborted) throw new Error("ABORTED");
        return await new Promise((_resolve, reject) => {
          request.signal?.addEventListener("abort", () => reject(new Error("ABORTED")), {
            once: true,
          });
        });
      },
    };
    const analysis = analyzePracticeWithCodex(database, document.practiceId, {
      dataDirectory: directory,
      adapter,
      signal: controller.signal,
    });
    controller.abort();

    await expect(analysis).rejects.toThrow("TOOL_CANCELLED");
    expect(database.prepare("SELECT status, error_code FROM codex_runs").get()).toEqual({
      status: "cancelled",
      error_code: "TOOL_CANCELLED",
    });
  });

  it("marca come fallita una run se non riesce a preparare il workspace", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-codex-workspace-failure-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const document = await ingestDocument(
      database,
      new File(["Documento sintetico da analizzare."], "nota.txt", { type: "text/plain" }),
      { newPracticeTitle: "Pratica Codex senza blob" },
      directory,
    );
    await processDocument(database, document.id, { dataDirectory: directory });
    const row = database
      .prepare("SELECT blob_path FROM documents WHERE id = ?")
      .get(document.id) as {
      blob_path: string;
    };
    unlinkSync(resolveBlobPath(directory, row.blob_path));

    await expect(
      analyzePracticeWithCodex(database, document.practiceId, { dataDirectory: directory }),
    ).rejects.toThrow();
    expect(database.prepare("SELECT status FROM codex_runs").get()).toEqual({ status: "failed" });
  });
});
