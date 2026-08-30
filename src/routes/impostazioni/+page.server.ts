import { fail, redirect } from "@sveltejs/kit";
import { statfsSync } from "node:fs";
import type { Actions, PageServerLoad } from "./$types";
import { getLauncherCapabilities } from "$lib/server/launchers";
import { getCodexCapability } from "$lib/server/codex-capability";
import { getDataDirectory } from "$lib/server/config";
import { openDatabase } from "$lib/server/database";
import { createManualBackup, getLatestManualBackup } from "$lib/server/manual-backup";
import { getOperationalHealth } from "$lib/server/health";

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.ownerId) redirect(303, "/login");
  const dataDirectory = getDataDirectory();
  const database = openDatabase();
  return {
    launchers: getLauncherCapabilities(),
    codex: await getCodexCapability(),
    backup: await getLatestManualBackup(dataDirectory),
    operations: getOperationalHealth(database, statfsSync(dataDirectory, { bigint: true })),
  };
};

export const actions = {
  backup: async ({ locals }) => {
    if (!locals.ownerId) redirect(303, "/login");
    try {
      await createManualBackup(openDatabase(), getDataDirectory());
      return { backupCreated: true };
    } catch (backupError) {
      if (backupError instanceof Error && backupError.message === "BACKUP_JOB_TIMEOUT")
        return fail(409, {
          backupError:
            "L’attività in corso non si è conclusa entro la finestra di manutenzione. Riprova al termine.",
        });
      if (backupError instanceof Error && backupError.message === "MAINTENANCE_ACTIVE")
        return fail(409, { backupError: "È già in corso un’operazione di manutenzione." });
      throw backupError;
    }
  },
} satisfies Actions;
