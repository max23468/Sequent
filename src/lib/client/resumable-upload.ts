const CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_FILE_BYTES = 250 * 1024 * 1024;
const MAX_BATCH_BYTES = 2 * 1024 * 1024 * 1024;

interface UploadDestination {
  practiceId?: string;
  newPracticeTitle?: string;
}

interface UploadResult {
  practiceId: string;
  documentId: string;
  location: string;
}

interface NewPracticeBatchState {
  practiceId: string;
  completedCount: number;
  lastResult: UploadResult;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: ArrayBuffer | Uint8Array): Promise<string> {
  let input: ArrayBuffer;
  if (value instanceof Uint8Array) {
    const copy = new Uint8Array(value.byteLength);
    copy.set(value);
    input = copy.buffer;
  } else input = value;
  return bytesToHex(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", input)));
}

async function fileFingerprint(file: File): Promise<string> {
  const chunks: string[] = [];
  for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
    const chunk = file.slice(offset, Math.min(file.size, offset + CHUNK_BYTES));
    chunks.push(`${chunk.size}:${await sha256(await chunk.arrayBuffer())}`);
  }
  return await sha256(new TextEncoder().encode(chunks.join("|")));
}

async function batchStorageKey(
  title: string,
  files: File[],
  fingerprints: string[],
): Promise<string> {
  const manifest = files.map((file, index) => ({
    name: file.name,
    size: file.size,
    fingerprint: fingerprints[index],
  }));
  return `sequent-upload-batch:${await sha256(
    new TextEncoder().encode(JSON.stringify({ title, files: manifest })),
  )}`;
}

function loadBatchState(key: string, fileCount: number): NewPracticeBatchState | null {
  try {
    const serialized = window.localStorage.getItem(key);
    if (!serialized) return null;
    const state = JSON.parse(serialized) as Partial<NewPracticeBatchState>;
    if (
      typeof state.practiceId !== "string" ||
      !Number.isInteger(state.completedCount) ||
      (state.completedCount as number) < 0 ||
      (state.completedCount as number) > fileCount ||
      !state.lastResult ||
      state.lastResult.practiceId !== state.practiceId
    ) {
      window.localStorage.removeItem(key);
      return null;
    }
    return state as NewPracticeBatchState;
  } catch {
    window.localStorage.removeItem(key);
    return null;
  }
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) throw new Error((await response.text()).slice(0, 500));
  return (await response.json()) as Record<string, unknown>;
}

export async function uploadFilesResumably(
  files: File[],
  destination: UploadDestination,
  onProgress: (progress: number, fileName: string) => void,
): Promise<UploadResult> {
  if (files.length === 0) throw new Error("Scegli almeno un documento.");
  if (files.some((file) => file.size === 0)) throw new Error("Un documento selezionato è vuoto.");
  if (files.some((file) => file.size > MAX_FILE_BYTES))
    throw new Error("Ogni documento deve essere al massimo 250 MB.");
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (totalBytes > MAX_BATCH_BYTES) throw new Error("Il caricamento complessivo supera 2 GB.");

  const fingerprints: string[] = [];
  for (const file of files) fingerprints.push(await fileFingerprint(file));
  const batchKey = destination.newPracticeTitle
    ? await batchStorageKey(destination.newPracticeTitle, files, fingerprints)
    : null;
  const batchState = batchKey ? loadBatchState(batchKey, files.length) : null;
  let completedCount = batchState?.completedCount ?? 0;
  let uploadedBytes = files.slice(0, completedCount).reduce((total, file) => total + file.size, 0);
  let practiceId = destination.practiceId;
  if (batchState) practiceId = batchState.practiceId;
  let lastResult: UploadResult | null = batchState?.lastResult ?? null;
  for (const [index, file] of files.entries()) {
    if (index < completedCount) continue;
    const target = practiceId ? { practiceId } : { newPracticeTitle: destination.newPracticeTitle };
    const key = `sequent-upload:${practiceId ?? destination.newPracticeTitle}:${fingerprints[index]}`;
    let sessionId = window.localStorage.getItem(key);
    let offset = 0;
    if (sessionId) {
      const statusResponse = await fetch(`/api/uploads/${sessionId}`);
      if (statusResponse.ok) {
        const status = await statusResponse.json();
        if (status.originalName === file.name && status.totalSize === file.size)
          offset = status.offset;
        else sessionId = null;
      } else sessionId = null;
    }
    if (!sessionId) {
      const created = await responseJson(
        await fetch("/api/uploads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...target,
            originalName: file.name,
            mediaType: file.type,
            totalSize: file.size,
          }),
        }),
      );
      sessionId = String(created.id);
      offset = Number(created.offset);
      window.localStorage.setItem(key, sessionId);
    }
    while (offset < file.size) {
      const chunk = file.slice(offset, Math.min(file.size, offset + CHUNK_BYTES));
      const updated = await responseJson(
        await fetch(`/api/uploads/${sessionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/octet-stream", "Upload-Offset": String(offset) },
          body: chunk,
        }),
      );
      offset = Number(updated.offset);
      onProgress(Math.round(((uploadedBytes + offset) / totalBytes) * 100), file.name);
    }
    const completed = await responseJson(
      await fetch(`/api/uploads/${sessionId}/complete`, { method: "POST" }),
    );
    lastResult = {
      practiceId: String(completed.practiceId),
      documentId: String(completed.documentId),
      location: String(completed.location),
    };
    practiceId = lastResult.practiceId;
    uploadedBytes += file.size;
    completedCount = index + 1;
    if (batchKey) {
      window.localStorage.setItem(
        batchKey,
        JSON.stringify({ practiceId, completedCount, lastResult } satisfies NewPracticeBatchState),
      );
    }
    window.localStorage.removeItem(key);
  }
  if (batchKey) window.localStorage.removeItem(batchKey);
  return lastResult as UploadResult;
}

export const resumableUploadInternals = { fileFingerprint, batchStorageKey };
