import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, openDatabase } from "../../src/lib/server/database.ts";
import { ingestDocument } from "../../src/lib/server/document-ingestion.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    closeDatabase(directory);
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("acquisizione documentale", () => {
  it("crea pratica, documento e job in un unico esito applicativo", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-ingestion-"));
    directories.push(directory);
    const database = openDatabase(directory);

    const document = await ingestDocument(
      database,
      new File(["contenuto sintetico"], "originale.txt", { type: "text/plain" }),
      { newPracticeTitle: "Pratica da documento" },
      directory,
    );

    expect(
      database.prepare("SELECT title FROM practices WHERE id = ?").get(document.practiceId),
    ).toMatchObject({ title: "Pratica da documento" });
    expect(
      database.prepare("SELECT practice_id FROM documents WHERE id = ?").get(document.id),
    ).toMatchObject({ practice_id: document.practiceId });
    expect(
      database.prepare("SELECT status FROM jobs WHERE document_id = ?").get(document.id),
    ).toMatchObject({ status: "queued" });
  });

  it("non lascia una pratica vuota quando la persistenza del file fallisce", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-ingestion-failure-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const file = new File(["contenuto"], "errore.txt", { type: "text/plain" });
    Object.defineProperty(file, "stream", {
      value: () =>
        new ReadableStream({
          start(controller) {
            controller.error(new Error("SYNTHETIC_UPLOAD_FAILURE"));
          },
        }),
    });

    await expect(
      ingestDocument(database, file, { newPracticeTitle: "Pratica da non lasciare" }, directory),
    ).rejects.toThrow("SYNTHETIC_UPLOAD_FAILURE");
    expect(database.prepare("SELECT count(*) AS count FROM practices").get()).toMatchObject({
      count: 0,
    });
  });
});
