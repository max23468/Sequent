import { redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { revokeSession } from "$lib/server/auth";
import { openDatabase } from "$lib/server/database";
import { deleteSessionCookie } from "$lib/server/session-cookie";

export const POST: RequestHandler = ({ locals, cookies }) => {
  if (locals.sessionId) revokeSession(openDatabase(), locals.sessionId);
  deleteSessionCookie(cookies);
  redirect(303, "/login");
};
