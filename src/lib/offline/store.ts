import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import {
  OFFLINE_DATABASE_NAME,
  OFFLINE_DATABASE_VERSION,
  OFFLINE_SCHEMA_VERSION,
  type OfflineAttachment,
  type OfflineConflict,
  type OfflineDocument,
  type OfflineMutation,
  type OfflinePractice,
} from "./types";

interface SequentOfflineDatabase extends DBSchema {
  practices: { key: string; value: OfflinePractice };
  documents: {
    key: string;
    value: OfflineDocument;
    indexes: { "by-practice": string; "by-document": string; "by-resource": string };
  };
  mutations: {
    key: string;
    value: OfflineMutation;
    indexes: { "by-practice": string };
  };
  attachments: {
    key: string;
    value: OfflineAttachment;
    indexes: { "by-practice": string };
  };
  conflicts: { key: string; value: OfflineConflict };
}

let databasePromise: Promise<IDBPDatabase<SequentOfflineDatabase>> | undefined;

async function notifyOfflineWorker(message: unknown) {
  const registration = await navigator.serviceWorker.getRegistration();
  const worker = navigator.serviceWorker.controller ?? registration?.active;
  if (!worker) return;
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => reject(new Error("OFFLINE_WORKER_TIMEOUT")), 10_000);
    channel.port1.onmessage = (event) => {
      window.clearTimeout(timeout);
      if (event.data?.ok) resolve();
      else reject(new Error(event.data?.error ?? "OFFLINE_WORKER_FAILED"));
    };
    worker.postMessage(message, [channel.port2]);
  });
}

function randomId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function database() {
  databasePromise ??= openDB<SequentOfflineDatabase>(
    OFFLINE_DATABASE_NAME,
    OFFLINE_DATABASE_VERSION,
    {
      upgrade(db, oldVersion, _newVersion, transaction) {
        if (oldVersion < 1) {
          db.createObjectStore("practices", { keyPath: "id" });
          const documents = db.createObjectStore("documents", { keyPath: "key" });
          documents.createIndex("by-practice", "practiceId");
          documents.createIndex("by-document", "documentId", { unique: true });
          const mutations = db.createObjectStore("mutations", { keyPath: "id" });
          mutations.createIndex("by-practice", "practiceId");
          const attachments = db.createObjectStore("attachments", { keyPath: "id" });
          attachments.createIndex("by-practice", "practiceId");
          db.createObjectStore("conflicts", { keyPath: "practiceId" });
        }
        if (oldVersion < 2) {
          const documents = transaction.objectStore("documents");
          documents.createIndex("by-resource", "resourcePath", { unique: true });
          void documents.openCursor().then(function migrateDocument(cursor): Promise<void> | void {
            if (!cursor) return;
            const document = cursor.value;
            if (!document.resourcePath) {
              document.resourcePath = `/api/documents/${document.documentId}/content`;
              cursor.update(document);
            }
            return cursor.continue().then(migrateDocument);
          });
          const practices = transaction.objectStore("practices");
          void practices.openCursor().then(function migratePractice(cursor): Promise<void> | void {
            if (!cursor) return;
            cursor.update({ ...cursor.value, schemaVersion: OFFLINE_SCHEMA_VERSION });
            return cursor.continue().then(migratePractice);
          });
        }
      },
    },
  );
  return databasePromise;
}

export function getOfflinePractice(practiceId: string) {
  return database().then((db) => db.get("practices", practiceId));
}

export function putOfflinePractice(practice: OfflinePractice) {
  return database().then((db) => db.put("practices", practice));
}

export async function putOfflineDocument(document: Omit<OfflineDocument, "key">) {
  return (await database()).put("documents", {
    ...document,
    key: `${document.practiceId}:${document.resourcePath}`,
  });
}

export async function queueOfflineMutation(mutation: Omit<OfflineMutation, "id" | "createdAt">) {
  return (await database()).put("mutations", {
    ...mutation,
    id: randomId(),
    createdAt: new Date().toISOString(),
  });
}

export async function listOfflineMutations(practiceId: string) {
  return (await database()).getAllFromIndex("mutations", "by-practice", practiceId);
}

export async function deleteOfflineMutation(id: string) {
  return (await database()).delete("mutations", id);
}

export async function queueOfflineAttachment(
  attachment: Omit<OfflineAttachment, "id" | "createdAt">,
) {
  return (await database()).put("attachments", {
    ...attachment,
    id: randomId(),
    createdAt: new Date().toISOString(),
  });
}

export async function listOfflineAttachments(practiceId: string) {
  return (await database()).getAllFromIndex("attachments", "by-practice", practiceId);
}

export async function deleteOfflineAttachment(id: string) {
  return (await database()).delete("attachments", id);
}

export function getOfflineConflict(practiceId: string) {
  return database().then((db) => db.get("conflicts", practiceId));
}

export function putOfflineConflict(conflict: OfflineConflict) {
  return database().then((db) => db.put("conflicts", conflict));
}

export function deleteOfflineConflict(practiceId: string) {
  return database().then((db) => db.delete("conflicts", practiceId));
}

export async function removeOfflinePractice(practiceId: string) {
  const db = await database();
  const transaction = db.transaction(
    ["practices", "documents", "mutations", "attachments", "conflicts"],
    "readwrite",
  );
  const deleteIndexed = async (storeName: "documents" | "mutations" | "attachments") => {
    const keys = await transaction
      .objectStore(storeName)
      .index("by-practice")
      .getAllKeys(practiceId);
    await Promise.all(keys.map((key) => transaction.objectStore(storeName).delete(key)));
  };
  await Promise.all([
    transaction.objectStore("practices").delete(practiceId),
    transaction.objectStore("conflicts").delete(practiceId),
    deleteIndexed("documents"),
    deleteIndexed("mutations"),
    deleteIndexed("attachments"),
  ]);
  await transaction.done;
  await notifyOfflineWorker({ type: "REMOVE_PRACTICE", practiceId });
}

export async function clearAllOfflineData() {
  const db = await database();
  const transaction = db.transaction(
    ["practices", "documents", "mutations", "attachments", "conflicts"],
    "readwrite",
  );
  await Promise.all([
    transaction.objectStore("practices").clear(),
    transaction.objectStore("documents").clear(),
    transaction.objectStore("mutations").clear(),
    transaction.objectStore("attachments").clear(),
    transaction.objectStore("conflicts").clear(),
  ]);
  await transaction.done;
  db.close();
  databasePromise = undefined;
  await notifyOfflineWorker({ type: "CLEAR_OFFLINE" });
}

export function newOfflinePractice(input: {
  id: string;
  title: string;
  declarationId: string;
  baseRevision: number;
  routeCount: number;
  documentCount: number;
}): OfflinePractice {
  const now = new Date().toISOString();
  return {
    ...input,
    schemaVersion: OFFLINE_SCHEMA_VERSION,
    status: "downloading",
    downloadedDocumentCount: 0,
    selectedAt: now,
    updatedAt: now,
    failureReason: null,
    needsRefresh: false,
  };
}
