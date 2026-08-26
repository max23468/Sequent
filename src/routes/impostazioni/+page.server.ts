import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { getLauncherCapabilities } from "$lib/server/launchers";
import { getCodexCapability } from "$lib/server/codex-capability";

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.ownerId) redirect(303, "/login");
  return { launchers: getLauncherCapabilities(), codex: await getCodexCapability() };
};
