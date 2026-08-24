import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { getLauncherCapabilities } from "$lib/server/launchers";

export const load: PageServerLoad = ({ locals }) => {
  if (!locals.ownerId) redirect(303, "/login");
  return { launchers: getLauncherCapabilities() };
};
