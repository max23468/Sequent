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

  let uploadedBytes = 0;
  let practiceId = destination.practiceId;
  let lastResult: UploadResult | null = null;
  for (const file of files) {
    const target = practiceId ? { practiceId } : { newPracticeTitle: destination.newPracticeTitle };
    const key = `sequent-upload:${practiceId ?? destination.newPracticeTitle}:${file.name}:${file.size}:${file.lastModified}`;
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
    window.localStorage.removeItem(key);
    lastResult = {
      practiceId: String(completed.practiceId),
      documentId: String(completed.documentId),
      location: String(completed.location),
    };
    practiceId = lastResult.practiceId;
    uploadedBytes += file.size;
  }
  return lastResult as UploadResult;
}
