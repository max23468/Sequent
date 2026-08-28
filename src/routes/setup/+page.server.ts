import { fail, redirect } from "@sveltejs/kit";
import { z } from "zod";
import type { Actions, PageServerLoad } from "./$types";
import {
  createOwnerSession,
  hasOwner,
  MIN_PASSWORD_LENGTH,
  SESSION_COOKIE,
  SESSION_COOKIE_MAX_AGE,
} from "$lib/server/auth";
import { useSecureCookies } from "$lib/server/config";
import { openDatabase } from "$lib/server/database";

const usernameSchema = z
  .string()
  .trim()
  .min(1, "Inserisci il nome utente.")
  .max(64, "Usa al massimo 64 caratteri.")
  .transform((value) => value.normalize("NFKC"));

const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Usa almeno ${MIN_PASSWORD_LENGTH} caratteri.`)
  .max(128, "Usa al massimo 128 caratteri.");

export const load: PageServerLoad = () => {
  if (hasOwner(openDatabase())) redirect(303, "/login");
};

export const actions = {
  default: async ({ request, cookies }) => {
    const database = openDatabase();
    if (hasOwner(database)) redirect(303, "/login");
    const formData = await request.formData();
    const username = usernameSchema.safeParse(formData.get("username"));
    if (!username.success) return fail(400, { error: username.error.issues[0]?.message });
    const parsed = passwordSchema.safeParse(formData.get("password"));
    if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message });
    if (formData.get("passwordConfirm") !== parsed.data)
      return fail(400, { error: "Le password non coincidono." });
    const session = await createOwnerSession(database, username.data, parsed.data);
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
