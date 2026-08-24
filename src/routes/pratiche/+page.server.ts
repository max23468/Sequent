import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { openDatabase } from "$lib/server/database";
import { listPractices } from "$lib/server/practices";

export const load: PageServerLoad = ({ locals }) => {
  if (!locals.ownerId) redirect(303, "/login");
  return { practices: listPractices(openDatabase()) };
};
