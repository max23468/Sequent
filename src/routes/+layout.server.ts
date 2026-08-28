import type { LayoutServerLoad } from "./$types";
import { hasOwner } from "$lib/server/auth";
import { openDatabase } from "$lib/server/database";

export const load: LayoutServerLoad = ({ locals }) => ({
  authenticated: Boolean(locals.ownerId),
  needsSetup: !hasOwner(openDatabase()),
  username: locals.username,
});
