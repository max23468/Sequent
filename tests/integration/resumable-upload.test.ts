import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, openDatabase } from "../../src/lib/server/database.ts";
import { getDocument } from "../../src/lib/server/documents.ts";
import { createPractice } from "../../src/lib/server/practices.ts";
import {
  appendUploadChunk,
  completeUploadSession,
  createUploadSession,
  getUploadSession,
} from "../../src/lib/server/resumable-uploads.ts";

const directories: string[] = [];
const abundantCapacity = { availableBytes: async () => 2n * 1024n * 1024n * 1024n };
afterEach(() => {
  for (const directory of directories.splice(0)) {
    closeDatabase(directory);
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("caricamento riprendibile", () => {
  it("riprende dall'offset confermato e collega l'originale soltanto al completamento", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-resumable-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Pratica upload");
    const session = await createUploadSession(
      database,
      directory,
      {
        practiceId: practice.id,
        originalName: "documento.txt",
        mediaType: "text/plain",
        totalSize: 11,
      },
      abundantCapacity,
    );

    expect(
      await appendUploadChunk(
        database,
        session.id,
        0,
        Buffer.from("prima "),
        directory,
        abundantCapacity,
      ),
    ).toBe(6);
    await expect(
      appendUploadChunk(
        database,
        session.id,
        0,
        Buffer.from("errore"),
        directory,
        abundantCapacity,
      ),
    ).rejects.toThrow("UPLOAD_OFFSET_MISMATCH");
    expect(
      await appendUploadChunk(
        database,
        session.id,
        6,
        Buffer.from("parte"),
        directory,
        abundantCapacity,
      ),
    ).toBe(11);
    expect(getUploadSession(database, session.id)?.receivedSize).toBe(11);

    const document = await completeUploadSession(database, directory, session.id);
    expect(getDocument(database, document.id)).toMatchObject({
      originalName: "documento.txt",
      byteSize: 11,
      status: "received",
    });
    expect(getUploadSession(database, session.id)).toMatchObject({
      status: "completed",
      resultDocumentId: document.id,
    });
    expect(existsSync(session.tempPath)).toBe(false);
    expect(
      database.prepare("SELECT count(*) AS count FROM jobs WHERE document_id = ?").get(document.id),
    ).toEqual({ count: 2 });
    await expect(completeUploadSession(database, directory, session.id)).resolves.toEqual(document);
    expect(database.prepare("SELECT count(*) AS count FROM documents").get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT count(*) AS count FROM practices").get()).toEqual({ count: 1 });
  });

  it("riprende una sessione rimasta in completamento dopo il riavvio", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-resumable-restart-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const session = await createUploadSession(
      database,
      directory,
      {
        newPracticeTitle: "Pratica dopo riavvio",
        originalName: "documento.txt",
        mediaType: "text/plain",
        totalSize: 8,
      },
      abundantCapacity,
    );
    await appendUploadChunk(
      database,
      session.id,
      0,
      Buffer.from("completo"),
      directory,
      abundantCapacity,
    );
    database
      .prepare("UPDATE upload_sessions SET status = 'completing' WHERE id = ?")
      .run(session.id);

    const document = await completeUploadSession(database, directory, session.id);

    expect(getUploadSession(database, session.id)).toMatchObject({
      status: "completed",
      resultDocumentId: document.id,
    });
    expect(database.prepare("SELECT count(*) AS count FROM documents").get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT count(*) AS count FROM practices").get()).toEqual({ count: 1 });
  });

  it("non completa un file parziale", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-resumable-partial-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Pratica upload parziale");
    const session = await createUploadSession(
      database,
      directory,
      {
        practiceId: practice.id,
        originalName: "documento.txt",
        mediaType: "text/plain",
        totalSize: 8,
      },
      abundantCapacity,
    );
    await appendUploadChunk(
      database,
      session.id,
      0,
      Buffer.from("parz"),
      directory,
      abundantCapacity,
    );
    await expect(completeUploadSession(database, directory, session.id)).rejects.toThrow(
      "UPLOAD_INCOMPLETE",
    );
    expect(database.prepare("SELECT count(*) AS count FROM documents").get()).toEqual({ count: 0 });
  });

  it("riserva lo spazio tra sessioni e lo ricontrolla prima dei chunk", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-resumable-capacity-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const reserve = 512n * 1024n * 1024n;
    const availableBytes = async () => reserve + 10n;
    const session = await createUploadSession(
      database,
      directory,
      {
        newPracticeTitle: "Pratica con capacità",
        originalName: "primo.txt",
        mediaType: "text/plain",
        totalSize: 8,
      },
      { availableBytes },
    );

    await expect(
      createUploadSession(
        database,
        directory,
        {
          newPracticeTitle: "Seconda pratica",
          originalName: "secondo.txt",
          mediaType: "text/plain",
          totalSize: 8,
        },
        { availableBytes },
      ),
    ).rejects.toThrow("UPLOAD_STORAGE_INSUFFICIENT");
    await expect(
      appendUploadChunk(database, session.id, 0, Buffer.from("1234"), directory, {
        availableBytes: async () => reserve + 7n,
      }),
    ).rejects.toThrow("UPLOAD_STORAGE_INSUFFICIENT");
    expect(getUploadSession(database, session.id)?.receivedSize).toBe(0);
  });
});
