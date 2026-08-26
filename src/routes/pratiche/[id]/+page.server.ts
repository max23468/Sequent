import { error, fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { openDatabase } from "$lib/server/database";
import { describeDocumentIngestionFailure, ingestDocument } from "$lib/server/document-ingestion";
import { decideReviewItem, getDocumentText, listReviewItems } from "$lib/server/documents";
import {
  enqueuePracticeAnalysis,
  listFailedBlobVerifications,
  listPracticeJobs,
  retryJob,
} from "$lib/server/jobs";
import { listCodexRuns } from "$lib/server/codex-analysis";
import { getPractice, listPracticeDocuments } from "$lib/server/practices";

export const load: PageServerLoad = ({ locals, params, url }) => {
  if (!locals.ownerId) redirect(303, "/login");
  const database = openDatabase();
  const practice = getPractice(database, params.id);
  if (!practice) error(404, "Pratica non trovata");
  const documents = listPracticeDocuments(database, params.id);
  const selectedId = url.searchParams.get("documento");
  const reviewItems = listReviewItems(database, params.id);
  const selectedReviewId = url.searchParams.get("verifica");
  const selectedReview =
    reviewItems.find((item) => item.id === selectedReviewId) ?? reviewItems.at(0) ?? null;
  const selectedDocument =
    documents.find((document) => document.id === selectedId) ??
    documents.find((document) => document.id === selectedReview?.documentId) ??
    documents.at(0) ??
    null;
  const jobs = listPracticeJobs(database, params.id);
  return {
    practice,
    documents,
    failedVerifications: listFailedBlobVerifications(database, params.id),
    selectedDocument,
    selectedDocumentPages: selectedDocument ? getDocumentText(database, selectedDocument.id) : [],
    reviewItems,
    selectedReview,
    activeJobs: jobs.filter((job) => job.status === "queued" || job.status === "running"),
    failedJobs: jobs.filter((job) => job.status === "failed"),
    codexRuns: listCodexRuns(database, params.id),
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
  analyze: ({ locals, params }) => {
    if (!locals.ownerId) redirect(303, "/login");
    const database = openDatabase();
    if (!getPractice(database, params.id)) error(404, "Pratica non trovata");
    const documents = listPracticeDocuments(database, params.id);
    if (documents.length === 0)
      return fail(400, { analyzeError: "Carica almeno un documento prima dell’analisi." });
    if (
      documents.every(
        (document) => document.status !== "processed" && document.status !== "to_review",
      )
    )
      return fail(409, {
        analyzeError: "Attendi il completamento della pipeline documentale.",
      });
    enqueuePracticeAnalysis(database, params.id);
    redirect(303, `/pratiche/${params.id}?sezione=verifications`);
  },
  review: async ({ locals, params, request }) => {
    if (!locals.ownerId) redirect(303, "/login");
    const formData = await request.formData();
    const itemId = String(formData.get("itemId") ?? "");
    const decision = String(formData.get("decision") ?? "");
    const database = openDatabase();
    const item = listReviewItems(database, params.id).find((candidate) => candidate.id === itemId);
    if (!item) return fail(404, { reviewError: "Verifica non trovata o già risolta." });
    if (!["confirmed", "edited", "rejected", "ignored"].includes(decision))
      return fail(400, { reviewError: "Decisione non valida." });
    const editedValue = String(formData.get("value") ?? "").trim();
    if (decision === "edited" && (!editedValue || editedValue.length > 2_000))
      return fail(400, { reviewError: "Inserisci un valore valido da confermare." });
    const accepted = decideReviewItem(database, params.id, itemId, {
      status: decision as "confirmed" | "edited" | "rejected" | "ignored",
      value: decision === "edited" ? editedValue : item.proposedValue,
    });
    if (!accepted) return fail(409, { reviewError: "La verifica è già stata aggiornata." });
    redirect(303, `/pratiche/${params.id}?sezione=verifications`);
  },
  retry: async ({ locals, params, request }) => {
    if (!locals.ownerId) redirect(303, "/login");
    const formData = await request.formData();
    const jobId = String(formData.get("jobId") ?? "");
    if (!retryJob(openDatabase(), jobId, params.id))
      return fail(409, { retryError: "Il lavoro non può essere ritentato." });
    redirect(303, `/pratiche/${params.id}`);
  },
} satisfies Actions;
