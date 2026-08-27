import { error, json, redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getDataDirectory } from "$lib/server/config";
import { openDatabase } from "$lib/server/database";
import { appendUploadChunk, getUploadSession } from "$lib/server/resumable-uploads";

export const GET: RequestHandler = ({ locals, params }) => {
  if (!locals.ownerId) redirect(303, "/login");
  const session = getUploadSession(openDatabase(), params.id);
  if (!session) error(404, "Caricamento non trovato");
  return json({
    id: session.id,
    originalName: session.originalName,
    totalSize: session.totalSize,
    offset: session.receivedSize,
    status: session.status,
  });
};

export const PATCH: RequestHandler = async ({ locals, params, request, url }) => {
  if (!locals.ownerId) redirect(303, "/login");
  if (request.headers.get("origin") !== url.origin) error(403, "Origine non valida");
  if (request.headers.get("content-type") !== "application/octet-stream")
    error(415, "Tipo di chunk non valido");
  const offset = Number(request.headers.get("upload-offset"));
  if (!Number.isSafeInteger(offset) || offset < 0) error(400, "Offset non valido");
  try {
    const nextOffset = await appendUploadChunk(
      openDatabase(),
      params.id,
      offset,
      new Uint8Array(await request.arrayBuffer()),
      getDataDirectory(),
    );
    return json({ offset: nextOffset });
  } catch (uploadError) {
    const code = uploadError instanceof Error ? uploadError.message : "UPLOAD_FAILED";
    if (code === "UPLOAD_SESSION_INVALID") error(404, "Caricamento non trovato");
    if (code === "UPLOAD_OFFSET_MISMATCH") error(409, "Offset non allineato");
    if (code === "UPLOAD_STORAGE_INSUFFICIENT") error(507, "Spazio insufficiente sul server");
    error(400, "Chunk non valido");
  }
};
