import { resolve } from "node:path";
import { restoreBaseBackup } from "../../src/lib/server/backup.ts";
import { getDataDirectory } from "../../src/lib/server/config.ts";
import { closeDatabase } from "../../src/lib/server/database.ts";

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

const backup = argument("--backup");
if (!backup) throw new Error("BACKUP_PATH_REQUIRED");
const dataDirectory = resolve(argument("--data-dir") ?? getDataDirectory());
closeDatabase(dataDirectory);
const result = await restoreBaseBackup(resolve(backup), dataDirectory, {
  replace: process.argv.includes("--replace"),
});
console.log(`Backup ripristinato in ${result.dataDirectory}.`);
if (result.previousDataDirectory)
  console.log(`La base precedente è conservata in ${result.previousDataDirectory}.`);
