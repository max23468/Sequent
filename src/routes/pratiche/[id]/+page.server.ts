import { error, fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { storeUpload } from "$lib/server/blob-store";
import { openDatabase } from "$lib/server/database";
import { enqueueJob } from "$lib/server/jobs";
import { getPractice, listPracticeDocuments } from "$lib/server/practices";

export const load: PageServerLoad = ({ locals, params, url }) => {
  if (!locals.ownerId) redirect(303, "/login");
  const database = openDatabase();
  const practice = getPractice(database, params.id);
  if (!practice) error(404, "Pratica non trovata");
  const documents = listPracticeDocuments(database, params.id);
  const selectedId = url.searchParams.get("documento");
  return {
    practice,
    documents,
    selectedDocument:
      documents.find((document) => document.id === selectedId) ?? documents.at(0) ?? null,
  };
};

export const actions = {
  upload: async ({ locals, params, request }) => {
    if (!locals.ownerId) redirect(303, "/login");
    const database = openDatabase();
    if (!getPractice(database, params.id)) error(404, "Pratica non trovata");
    const file = (await request.formData()).get("file");
    if (!(file instanceof File) || file.size === 0)
      return fail(400, { uploadError: "Scegli un documento da caricare." });
    try {
      const document = await storeUpload(database, params.id, file);
      enqueueJob(
        database,
        "foundation.verify_blob",
        { sha256: document.sha256 },
        { practiceId: params.id, documentId: document.id },
      );
      redirect(303, `/pratiche/${params.id}?documento=${document.id}`);
    } catch (uploadError) {
      if (uploadError instanceof Error && uploadError.message === "FILE_TOO_LARGE")
        return fail(413, { uploadError: "Il documento supera il limite consentito." });
      throw uploadError;
    }
  },
} satisfies Actions;
