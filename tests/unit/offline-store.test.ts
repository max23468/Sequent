import "fake-indexeddb/auto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  OFFLINE_DATABASE_NAME,
  OFFLINE_DATABASE_VERSION,
  OFFLINE_SCHEMA_VERSION,
} from "$lib/offline/types";

function deleteDatabase() {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(OFFLINE_DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function createLegacyDatabase() {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      database.createObjectStore("practices", { keyPath: "id" });
      const documents = database.createObjectStore("documents", { keyPath: "key" });
      documents.createIndex("by-practice", "practiceId");
      documents.createIndex("by-document", "documentId", { unique: true });
      const mutations = database.createObjectStore("mutations", { keyPath: "id" });
      mutations.createIndex("by-practice", "practiceId");
      const attachments = database.createObjectStore("attachments", { keyPath: "id" });
      attachments.createIndex("by-practice", "practiceId");
      database.createObjectStore("conflicts", { keyPath: "practiceId" });
    };
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(["practices", "documents"], "readwrite");
      transaction.objectStore("practices").put({
        id: "practice-1",
        title: "Pratica legacy",
        declarationId: "declaration-1",
        baseRevision: 3,
        schemaVersion: 1,
        status: "complete",
        routeCount: 1,
        documentCount: 1,
        downloadedDocumentCount: 1,
        selectedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        failureReason: null,
        needsRefresh: false,
      });
      transaction.objectStore("documents").put({
        key: "practice-1:document-1",
        practiceId: "practice-1",
        documentId: "document-1",
        name: "fonte.pdf",
        mediaType: "application/pdf",
        byteSize: 3,
        blob: new Blob(["pdf"]),
      });
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    };
    request.onerror = () => reject(request.error);
  });
}

describe.sequential("archivio offline", () => {
  beforeAll(async () => {
    await deleteDatabase();
    await createLegacyDatabase();
  });

  it("migra in modo sicuro pratica e documenti dalla versione precedente", async () => {
    const { getOfflinePractice } = await import("$lib/offline/store");
    const practice = await getOfflinePractice("practice-1");
    expect(practice?.schemaVersion).toBe(OFFLINE_SCHEMA_VERSION);

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(OFFLINE_DATABASE_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(database.version).toBe(OFFLINE_DATABASE_VERSION);
    const transaction = database.transaction("documents", "readonly");
    const store = transaction.objectStore("documents");
    expect(store.indexNames.contains("by-resource")).toBe(true);
    const document = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
      const request = store.index("by-resource").get("/api/documents/document-1/content");
      request.onsuccess = () => resolve(request.result as Record<string, unknown> | undefined);
      request.onerror = () => reject(request.error);
    });
    expect(document?.documentId).toBe("document-1");
    database.close();
  });
});
