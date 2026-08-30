import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { openDatabase } from "$lib/server/database";
import { getPractice } from "$lib/server/practices";

export const GET: RequestHandler = ({ locals, params }) => {
  if (!locals.ownerId) error(401, "Accesso richiesto");
  const practice = getPractice(openDatabase(), params.id);
  if (!practice) error(404, "Pratica non trovata");
  return json(
    { revision: practice.revision, updatedAt: practice.updatedAt },
    { headers: { "cache-control": "private, no-store" } },
  );
};
