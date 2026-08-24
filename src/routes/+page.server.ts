import { fail, redirect } from "@sveltejs/kit";
import { z } from "zod";
import type { Actions, PageServerLoad } from "./$types";
import { hasOwner } from "$lib/server/auth";
import { openDatabase } from "$lib/server/database";
import { countActiveJobs } from "$lib/server/jobs";
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
  return { practices: listPractices(database), activeJobs: countActiveJobs(database) };
};

export const actions = {
  create: async ({ request, locals }) => {
    if (!locals.ownerId) redirect(303, "/login");
    const formData = await request.formData();
    const parsed = titleSchema.safeParse(formData.get("title"));
    if (!parsed.success) return fail(400, { createError: parsed.error.issues[0]?.message });
    createPractice(openDatabase(), parsed.data);
    return { created: true };
  },
} satisfies Actions;
