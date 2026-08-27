import { error, json, redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getDataDirectory } from "$lib/server/config";
import { openDatabase } from "$lib/server/database";
import { completeUploadSession } from "$lib/server/resumable-uploads";

export const POST: RequestHandler = async ({ locals, params, request, url }) => {
  if (!locals.ownerId) redirect(303, "/login");
  if (request.headers.get("origin") !== url.origin) error(403, "Origine non valida");
  try {
    const document = await completeUploadSession(openDatabase(), getDataDirectory(), params.id);
    return json({
      documentId: document.id,
      practiceId: document.practiceId,
      location: `/pratiche/${document.practiceId}?sezione=documents&documento=${document.id}`,
    });
  } catch (uploadError) {
    const code = uploadError instanceof Error ? uploadError.message : "UPLOAD_FAILED";
    if (code === "UPLOAD_SESSION_INVALID") error(404, "Caricamento non trovato");
    if (code === "UPLOAD_INCOMPLETE") error(409, "Caricamento incompleto");
    error(400, "Impossibile completare il caricamento");
  }
};
