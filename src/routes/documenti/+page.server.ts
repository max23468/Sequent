import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { openDatabase } from "$lib/server/database";
import { listDocuments } from "$lib/server/practices";

export const load: PageServerLoad = ({ locals }) => {
  if (!locals.ownerId) redirect(303, "/login");
  return { documents: listDocuments(openDatabase()) };
};
