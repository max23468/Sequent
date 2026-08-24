import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { storeUpload } from "$lib/server/blob-store";
import { openDatabase } from "$lib/server/database";
import { enqueueJob } from "$lib/server/jobs";

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.ownerId) error(401, "Autenticazione richiesta");
  const formData = await request.formData();
  const practiceId = String(formData.get("practiceId") ?? "");
  const file = formData.get("file");
  if (!(file instanceof File) || !practiceId) error(400, "File e pratica sono obbligatori");
  const database = openDatabase();
  const practice = database
    .prepare("SELECT 1 FROM practices WHERE id = ? AND status = 'active'")
    .get(practiceId);
  if (!practice) error(404, "Pratica non trovata");
  const document = await storeUpload(database, practiceId, file);
  const job = enqueueJob(
    database,
    "foundation.verify_blob",
    { sha256: document.sha256 },
    { practiceId, documentId: document.id },
  );
  return json({ document, job }, { status: 201 });
};
