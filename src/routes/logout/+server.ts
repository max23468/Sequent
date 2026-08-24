import { redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { revokeSession, SESSION_COOKIE, sessionCookieOptions } from "$lib/server/auth";
import { openDatabase } from "$lib/server/database";

export const POST: RequestHandler = ({ locals, cookies }) => {
  if (locals.sessionId) revokeSession(openDatabase(), locals.sessionId);
  cookies.delete(SESSION_COOKIE, sessionCookieOptions());
  redirect(303, "/login");
};
