import { fail, redirect } from "@sveltejs/kit";
import { z } from "zod";
import type { Actions, PageServerLoad } from "./$types";
import { hasOwner } from "$lib/server/auth";
import { openDatabase } from "$lib/server/database";
import { describeDocumentIngestionFailure, ingestDocument } from "$lib/server/document-ingestion";
import { listPendingReviewSummaries } from "$lib/server/documents";
import { listFailedBlobVerifications } from "$lib/server/jobs";
import { getLauncherCapabilities } from "$lib/server/launchers";
import { listPracticeDeadlines, listPracticeDomainSummaries } from "$lib/server/domain";
import { createPractice, listPractices } from "$lib/server/practices";

const titleSchema = z
  .string()
  .trim()
  .min(1, "Inserisci un nome.")
  .max(120, "Usa al massimo 120 caratteri.");

export const load: PageServerLoad = ({ locals }) => {
  const database = openDatabase();
  if (!hasOwner(database)) redirect(303, "/setup");
  if (!locals.ownerId) redirect(303, "/login");
  const practices = listPractices(database);
  return {
    practices,
    pendingReviews: listPendingReviewSummaries(database),
    failedVerifications: listFailedBlobVerifications(database),
    launchers: getLauncherCapabilities(),
    lastPractice: practices.at(0) ?? null,
    domainSummaries: listPracticeDomainSummaries(database),
    deadlines: listPracticeDeadlines(database),
  };
};

export const actions = {
  create: async ({ request, locals }) => {
    if (!locals.ownerId) redirect(303, "/login");
    const formData = await request.formData();
    const parsed = titleSchema.safeParse(formData.get("title"));
    if (!parsed.success) return fail(400, { createError: parsed.error.issues[0]?.message });
    const practice = createPractice(openDatabase(), parsed.data);
    redirect(303, `/pratiche/${practice.id}`);
  },
  upload: async ({ request, locals }) => {
    if (!locals.ownerId) redirect(303, "/login");
    const formData = await request.formData();
    const database = openDatabase();
    const practiceId = String(formData.get("practiceId") ?? "");
    const newTitle = titleSchema.safeParse(formData.get("newTitle"));
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0)
      return fail(400, { uploadError: "Scegli un documento da caricare." });
    let destination: { practiceId: string } | { newPracticeTitle: string };
    if (practiceId) destination = { practiceId };
    else {
      if (!newTitle.success)
        return fail(400, { uploadError: "Scegli una pratica o assegna un nome a quella nuova." });
      destination = { newPracticeTitle: newTitle.data };
    }
    try {
      const document = await ingestDocument(database, file, destination);
      redirect(303, `/pratiche/${document.practiceId}?documento=${document.id}`);
    } catch (error) {
      const failure = describeDocumentIngestionFailure(error);
      if (failure) return fail(failure.status, { uploadError: failure.message });
      throw error;
    }
  },
} satisfies Actions;
