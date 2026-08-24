import { dev } from "$app/environment";
import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = () => {
  if (!dev && process.env.SEQUENT_DESIGN_LAB !== "test") error(404, "Pagina non trovata");
  return {};
};
