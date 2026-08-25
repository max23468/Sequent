import { fail, redirect } from "@sveltejs/kit";
import { z } from "zod";
import type { Actions, PageServerLoad } from "./$types";
import {
  authenticate,
  hasOwner,
  issueSession,
  SESSION_COOKIE,
  SESSION_COOKIE_MAX_AGE,
} from "$lib/server/auth";
import { useSecureCookies } from "$lib/server/config";
import { openDatabase } from "$lib/server/database";

export const load: PageServerLoad = ({ locals }) => {
  if (!hasOwner(openDatabase())) redirect(303, "/setup");
  if (locals.ownerId) redirect(303, "/");
};

export const actions = {
  default: async ({ request, cookies, getClientAddress }) => {
    const parsed = z
      .string()
      .min(1)
      .max(128)
      .safeParse((await request.formData()).get("password"));
    if (!parsed.success) return fail(400, { error: "Credenziali non valide." });
    const database = openDatabase();
    const ownerId = await authenticate(database, parsed.data, getClientAddress());
    if (!ownerId) return fail(400, { error: "Credenziali non valide." });
    const session = issueSession(database, ownerId);
    cookies.set(SESSION_COOKIE, session.token, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: useSecureCookies(),
      maxAge: SESSION_COOKIE_MAX_AGE,
    });
    redirect(303, "/");
  },
} satisfies Actions;
