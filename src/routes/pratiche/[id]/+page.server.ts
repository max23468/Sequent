import { error, fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { openDatabase } from "$lib/server/database";
import { describeDocumentIngestionFailure, ingestDocument } from "$lib/server/document-ingestion";
import { listFailedBlobVerifications } from "$lib/server/jobs";
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
    failedVerifications: listFailedBlobVerifications(database, params.id),
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
      const document = await ingestDocument(database, file, { practiceId: params.id });
      redirect(303, `/pratiche/${params.id}?documento=${document.id}`);
    } catch (uploadError) {
      const failure = describeDocumentIngestionFailure(uploadError);
      if (failure) return fail(failure.status, { uploadError: failure.message });
      throw uploadError;
    }
  },
} satisfies Actions;
