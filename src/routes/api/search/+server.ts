import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { openDatabase } from "$lib/server/database";
import { searchWorkspace } from "$lib/server/search";

export const GET: RequestHandler = ({ locals, url }) => {
  if (!locals.ownerId) error(401, "Autenticazione richiesta");
  return json({ results: searchWorkspace(openDatabase(), url.searchParams.get("q") ?? "") });
};
