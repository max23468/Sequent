import { fail, redirect } from "@sveltejs/kit";
import { z } from "zod";
import type { Actions, PageServerLoad } from "./$types";
import { authenticate, hasOwner, issueSession } from "$lib/server/auth";
import { openDatabase } from "$lib/server/database";
import { setSessionCookie } from "$lib/server/session-cookie";

export const load: PageServerLoad = ({ locals }) => {
  if (!hasOwner(openDatabase())) redirect(303, "/setup");
  if (locals.ownerId) redirect(303, "/");
};

export const actions = {
  default: async ({ request, cookies, getClientAddress }) => {
    const formData = await request.formData();
    const username = z.string().trim().min(1).max(64).safeParse(formData.get("username"));
    const password = z.string().min(1).max(128).safeParse(formData.get("password"));
    if (!username.success || !password.success)
      return fail(400, { error: "Credenziali non valide." });
    const database = openDatabase();
    const ownerId = await authenticate(database, username.data, password.data, getClientAddress());
    if (!ownerId) return fail(400, { error: "Credenziali non valide." });
    const session = issueSession(database, ownerId);
    setSessionCookie(cookies, session.token);
    redirect(303, "/");
  },
} satisfies Actions;
