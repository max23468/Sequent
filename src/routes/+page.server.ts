import { fail, redirect } from "@sveltejs/kit";
import { z } from "zod";
import type { Actions, PageServerLoad } from "./$types";
import { hasOwner } from "$lib/server/auth";
import { openDatabase } from "$lib/server/database";
import { countActiveJobs } from "$lib/server/jobs";
import { createPractice, listPractices } from "$lib/server/practices";
import { storeUpload } from "$lib/server/blob-store";
import { enqueueJob } from "$lib/server/jobs";
import { getLauncherCapabilities } from "$lib/server/launchers";

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
    activeJobs: countActiveJobs(database),
    launchers: getLauncherCapabilities(),
    lastPractice: practices.at(0) ?? null,
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
    let practiceId = String(formData.get("practiceId") ?? "");
    const newTitle = titleSchema.safeParse(formData.get("newTitle"));
    if (!practiceId) {
      if (!newTitle.success)
        return fail(400, { uploadError: "Scegli una pratica o assegna un nome a quella nuova." });
      practiceId = createPractice(database, newTitle.data).id;
    }
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0)
      return fail(400, { uploadError: "Scegli un documento da caricare." });
    const exists = database
      .prepare("SELECT 1 FROM practices WHERE id = ? AND status = 'active'")
      .get(practiceId);
    if (!exists) return fail(404, { uploadError: "Pratica non trovata." });
    try {
      const document = await storeUpload(database, practiceId, file);
      enqueueJob(
        database,
        "foundation.verify_blob",
        { sha256: document.sha256 },
        { practiceId, documentId: document.id },
      );
      redirect(303, `/pratiche/${practiceId}?documento=${document.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "UPLOAD_FAILED";
      if (message === "FILE_TOO_LARGE")
        return fail(413, { uploadError: "Il documento supera il limite consentito." });
      if (message === "EMPTY_FILE")
        return fail(400, { uploadError: "Il documento selezionato è vuoto." });
      throw error;
    }
  },
} satisfies Actions;
