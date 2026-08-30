import { uploadFilesResumably } from "$lib/client/resumable-upload";
import { practiceSections } from "$lib/practice-workspace";
import { strToU8, zipSync } from "fflate";
import {
  deleteOfflineAttachment,
  deleteOfflineConflict,
  deleteOfflineMutation,
  getOfflineConflict,
  getOfflinePractice,
  listOfflineAttachments,
  listOfflineMutations,
  newOfflinePractice,
  putOfflineConflict,
  putOfflineDocument,
  putOfflinePractice,
  queueOfflineAttachment,
  queueOfflineMutation,
  removeOfflinePractice,
} from "./store";
import { OFFLINE_SCHEMA_VERSION, type OfflineConflict, type OfflinePractice } from "./types";

const ROUTE_ALLOWANCE_BYTES = 512 * 1024;
const SPACE_RESERVE_BYTES = 5 * 1024 * 1024;

export async function isServerReachable() {
  if (!navigator.onLine) return false;
  try {
    const response = await fetch(`/api/health?offline-check=${Date.now()}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

type PracticeData = {
  practice: { id: string; title: string };
  declaration: { id: string; revision: number };
  documents: Array<{
    id: string;
    originalName: string;
    mediaType: string;
    byteSize: number;
  }>;
  officialAttachments: Array<{
    id: string;
    preparedName: string;
    format: string;
    byteSize: number;
  }>;
  quadri: Array<{ id: string }>;
};

export interface OfflineState {
  practice?: OfflinePractice;
  conflict?: OfflineConflict;
  pendingMutations: number;
  pendingAttachments: number;
}

function practiceUrls(data: PracticeData): string[] {
  const pathname = `/pratiche/${data.practice.id}`;
  const declaration = encodeURIComponent(data.declaration.id);
  const operational = practiceSections.map(
    ({ id }) => `${pathname}?vista=operational&sezione=${id}&dichiarazione=${declaration}`,
  );
  const quadri = data.quadri.map(
    ({ id }) =>
      `${pathname}?vista=quadri&sezione=quadri&quadro=${encodeURIComponent(id)}&dichiarazione=${declaration}`,
  );
  return [...new Set([pathname, ...operational, ...quadri])];
}

async function cachePracticeRoutes(practiceId: string, urls: string[]) {
  const registration = await navigator.serviceWorker.ready;
  const worker = registration.active;
  if (!worker) throw new Error("OFFLINE_WORKER_UNAVAILABLE");
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => reject(new Error("OFFLINE_CACHE_TIMEOUT")), 60_000);
    channel.port1.onmessage = (event) => {
      window.clearTimeout(timeout);
      if (event.data?.ok) resolve();
      else reject(new Error(event.data?.error ?? "OFFLINE_CACHE_FAILED"));
    };
    worker.postMessage({ type: "CACHE_PRACTICE", practiceId, urls }, [channel.port2]);
  });
}

export async function readOfflineState(practiceId: string): Promise<OfflineState> {
  let [practice, conflict, mutations, attachments] = await Promise.all([
    getOfflinePractice(practiceId),
    getOfflineConflict(practiceId),
    listOfflineMutations(practiceId),
    listOfflineAttachments(practiceId),
  ]);
  if (
    practice &&
    practice.schemaVersion !== OFFLINE_SCHEMA_VERSION &&
    practice.status !== "read-only"
  ) {
    practice = {
      ...practice,
      status: "read-only",
      failureReason: "OFFLINE_SCHEMA_UNSAFE",
      updatedAt: new Date().toISOString(),
    };
    await putOfflinePractice(practice);
  }
  return {
    practice,
    conflict,
    pendingMutations: mutations.length,
    pendingAttachments: attachments.length,
  };
}

export async function makePracticeAvailableOffline(data: PracticeData) {
  const urls = practiceUrls(data);
  const existing = await getOfflinePractice(data.practice.id);
  if (existing) {
    const pendingCount =
      (await listOfflineMutations(data.practice.id)).length +
      (await listOfflineAttachments(data.practice.id)).length;
    if (pendingCount > 0) {
      const synchronization = await synchronizeOfflinePractice(data.practice.id);
      if (synchronization?.conflict) throw new Error("OFFLINE_PENDING_CONFLICT");
    }
  }
  const statusResponse = await fetch(`/api/offline/practices/${data.practice.id}`, {
    cache: "no-store",
  });
  if (!statusResponse.ok) throw new Error("OFFLINE_STATUS_FAILED");
  const { revision: currentRevision } = (await statusResponse.json()) as { revision: number };
  const resources = [
    ...data.documents.map((document) => ({
      id: document.id,
      name: document.originalName,
      mediaType: document.mediaType,
      byteSize: document.byteSize,
      resourcePath: `/api/documents/${document.id}/content`,
    })),
    ...data.officialAttachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.preparedName,
      mediaType: attachment.format === "TIFF-G4" ? "image/tiff" : "application/pdf",
      byteSize: attachment.byteSize,
      resourcePath: `/api/attachments/${attachment.id}/content`,
    })),
  ];
  const requiredBytes =
    resources.reduce((total, resource) => total + resource.byteSize, 0) +
    urls.length * ROUTE_ALLOWANCE_BYTES;
  const estimate = await navigator.storage?.estimate?.();
  const available = (estimate?.quota ?? Number.POSITIVE_INFINITY) - (estimate?.usage ?? 0);
  if (available < requiredBytes + SPACE_RESERVE_BYTES) throw new Error("OFFLINE_STORAGE_LOW");
  await navigator.storage?.persist?.();

  const stableExisting = await getOfflinePractice(data.practice.id);
  let practice = newOfflinePractice({
    id: data.practice.id,
    title: data.practice.title,
    declarationId: data.declaration.id,
    baseRevision: currentRevision,
    routeCount: urls.length,
    documentCount: resources.length,
  });
  if (!stableExisting) await putOfflinePractice(practice);

  try {
    await cachePracticeRoutes(data.practice.id, urls);
    let downloadedDocumentCount = 0;
    for (const document of resources) {
      const response = await fetch(document.resourcePath);
      if (!response.ok) throw new Error("OFFLINE_DOCUMENT_FAILED");
      const bytes = await response.arrayBuffer();
      await putOfflineDocument({
        practiceId: data.practice.id,
        documentId: document.id,
        resourcePath: document.resourcePath,
        name: document.name,
        mediaType: document.mediaType,
        byteSize: document.byteSize,
        bytes,
      });
      downloadedDocumentCount += 1;
      practice = { ...practice, downloadedDocumentCount, updatedAt: new Date().toISOString() };
      if (!stableExisting) await putOfflinePractice(practice);
    }
    practice = { ...practice, status: "complete", updatedAt: new Date().toISOString() };
    await putOfflinePractice(practice);
    return practice;
  } catch (error) {
    practice = {
      ...(stableExisting ?? practice),
      status: stableExisting?.status ?? "partial",
      failureReason: error instanceof Error ? error.message : "OFFLINE_DOWNLOAD_FAILED",
      updatedAt: new Date().toISOString(),
    };
    await putOfflinePractice(practice);
    throw error;
  }
}

export async function queueFieldForm(practiceId: string, form: HTMLFormElement) {
  const data = new FormData(form);
  const declarationId = String(data.get("declarationId") ?? "");
  const baseRevision = Number(data.get("expectedRevision"));
  if (!declarationId || !Number.isSafeInteger(baseRevision)) return false;
  const entries = Array.from(data.entries()).flatMap(([key, value]) =>
    typeof value === "string" ? ([[key, value]] as Array<[string, string]>) : [],
  );
  await queueOfflineMutation({
    practiceId,
    declarationId,
    baseRevision,
    action: form.action,
    entries,
  });
  return true;
}

function entryValue(entries: Array<[string, string]>, name: string) {
  return entries.findLast(([key]) => key === name)?.[1] ?? "";
}

export async function restoreQueuedFieldValues(practiceId: string, root: ParentNode = document) {
  const mutations = await listOfflineMutations(practiceId);
  for (const mutation of mutations) {
    const identityNames = ["declarationId", "entityId", "occurrenceId", "quadro", "returnSection"];
    const form = Array.from(root.querySelectorAll<HTMLFormElement>("form")).find((candidate) => {
      if (!candidate.action.includes("/saveFields")) return false;
      const candidateData = new FormData(candidate);
      return identityNames.every(
        (name) => String(candidateData.get(name) ?? "") === entryValue(mutation.entries, name),
      );
    });
    if (!form) continue;
    for (const [name, value] of mutation.entries) {
      if (!name.startsWith("value:")) continue;
      const controls = form.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
        `[name="${CSS.escape(name)}"]`,
      );
      for (const control of controls) {
        if (control instanceof HTMLInputElement && control.type === "checkbox")
          control.checked = control.value === value;
        else control.value = value;
      }
    }
  }
}

export async function queueAttachment(practiceId: string, file: File) {
  await queueOfflineAttachment({
    practiceId,
    name: file.name,
    mediaType: file.type || "application/octet-stream",
    byteSize: file.size,
    // WebKit non serializza in modo affidabile File o Blob creati dal file picker in IndexedDB.
    bytes: await file.arrayBuffer(),
  });
}

function mutationBody(
  mutation: Awaited<ReturnType<typeof listOfflineMutations>>[number],
  revision: number,
) {
  const body = new FormData();
  for (const [key, value] of mutation.entries) body.append(key, value);
  body.set("expectedRevision", String(revision));
  return body;
}

export async function synchronizeOfflinePractice(practiceId: string) {
  const practice = await getOfflinePractice(practiceId);
  if (!practice) return;
  const mutations = (await listOfflineMutations(practiceId)).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  const attachments = await listOfflineAttachments(practiceId);
  const statusResponse = await fetch(`/api/offline/practices/${practiceId}`, {
    cache: "no-store",
  });
  if (!statusResponse.ok) throw new Error("OFFLINE_STATUS_FAILED");
  const server = (await statusResponse.json()) as { revision: number };
  if (
    server.revision !== practice.baseRevision &&
    (mutations.length > 0 || attachments.length > 0)
  ) {
    await putOfflineConflict({
      practiceId,
      baseRevision: practice.baseRevision,
      detectedAt: new Date().toISOString(),
      reason: server.revision < practice.baseRevision ? "server-restored" : "server-changed",
    });
    return { conflict: true } as const;
  }
  if (mutations.length === 0) {
    await putOfflinePractice({ ...practice, baseRevision: server.revision });
  }
  let revision = practice.baseRevision;
  for (const mutation of mutations) {
    const response = await fetch(mutation.action, {
      method: "POST",
      body: mutationBody(mutation, revision),
      headers: { "x-sequent-offline-sync": "1" },
    });
    if (response.status === 409) {
      await putOfflineConflict({
        practiceId,
        baseRevision: practice.baseRevision,
        detectedAt: new Date().toISOString(),
        reason: "server-changed",
      });
      return { conflict: true } as const;
    }
    if (!response.ok) {
      throw new Error(`OFFLINE_MUTATION_SYNC_${response.status}`);
    }
    revision += 1;
    await deleteOfflineMutation(mutation.id);
  }
  for (const attachment of attachments) {
    const file = new File([attachment.bytes], attachment.name, { type: attachment.mediaType });
    await uploadFilesResumably([file], { practiceId }, () => undefined);
    await deleteOfflineAttachment(attachment.id);
  }
  await deleteOfflineConflict(practiceId);
  await putOfflinePractice({
    ...practice,
    baseRevision: revision,
    needsRefresh: mutations.length > 0 || attachments.length > 0,
    updatedAt: new Date().toISOString(),
  });
  return { conflict: false } as const;
}

export async function discardLocalChanges(practiceId: string) {
  for (const mutation of await listOfflineMutations(practiceId))
    await deleteOfflineMutation(mutation.id);
  for (const attachment of await listOfflineAttachments(practiceId))
    await deleteOfflineAttachment(attachment.id);
  await deleteOfflineConflict(practiceId);
}

export async function exportOfflineRecovery(practiceId: string) {
  const practice = await getOfflinePractice(practiceId);
  if (!practice) throw new Error("OFFLINE_PRACTICE_NOT_FOUND");
  const [mutations, attachments] = await Promise.all([
    listOfflineMutations(practiceId),
    listOfflineAttachments(practiceId),
  ]);
  const payload = {
    format: "sequent-offline-recovery",
    version: 1,
    exportedAt: new Date().toISOString(),
    practice,
    mutations,
    attachments: attachments.map(({ bytes: _bytes, ...attachment }) => attachment),
  };
  const archiveEntries: Record<string, Uint8Array> = {
    "manifest.json": strToU8(JSON.stringify(payload, null, 2)),
  };
  for (const attachment of attachments) {
    const safeName = attachment.name.replaceAll(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 120);
    archiveEntries[`allegati/${attachment.id}-${safeName || "allegato"}`] = new Uint8Array(
      attachment.bytes,
    );
  }
  const url = URL.createObjectURL(new Blob([zipSync(archiveEntries)], { type: "application/zip" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `sequent-modifiche-locali-${practiceId}.zip`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export { removeOfflinePractice };
