import { fail, redirect } from "@sveltejs/kit";
import { z } from "zod";
import type { Actions, PageServerLoad } from "./$types";
import { createOwner, hasOwner, issueSession, SESSION_COOKIE } from "$lib/server/auth";
import { useSecureCookies } from "$lib/server/config";
import { openDatabase } from "$lib/server/database";

const passwordSchema = z
  .string()
  .min(14, "Usa almeno 14 caratteri.")
  .max(128, "Usa al massimo 128 caratteri.")
  .regex(/[a-z]/, "Aggiungi una lettera minuscola.")
  .regex(/[A-Z]/, "Aggiungi una lettera maiuscola.")
  .regex(/[0-9]/, "Aggiungi un numero.");

export const load: PageServerLoad = () => {
  if (hasOwner(openDatabase())) redirect(303, "/login");
};

export const actions = {
  default: async ({ request, cookies }) => {
    const database = openDatabase();
    if (hasOwner(database)) redirect(303, "/login");
    const formData = await request.formData();
    const parsed = passwordSchema.safeParse(formData.get("password"));
    if (!parsed.success) return fail(400, { error: parsed.error.issues[0]?.message });
    if (formData.get("passwordConfirm") !== parsed.data)
      return fail(400, { error: "Le password non coincidono." });
    const ownerId = await createOwner(database, parsed.data);
    const session = issueSession(database, ownerId);
    cookies.set(SESSION_COOKIE, session.token, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: useSecureCookies(),
      maxAge: 365 * 86_400,
    });
    redirect(303, "/");
  },
} satisfies Actions;
