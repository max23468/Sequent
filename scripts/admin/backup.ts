import { resolve } from "node:path";
import { createBaseBackup, verifyBaseBackup } from "../../src/lib/server/backup.ts";
import { getDataDirectory } from "../../src/lib/server/config.ts";
import { closeDatabase, openDatabase } from "../../src/lib/server/database.ts";

const dataDirectory = getDataDirectory();
const destination = resolve(process.argv[2] ?? `${dataDirectory}/backups`);
const database = openDatabase(dataDirectory);

try {
  const backupPath = await createBaseBackup(database, dataDirectory, destination);
  await verifyBaseBackup(backupPath);
  console.log(backupPath);
} finally {
  closeDatabase(dataDirectory);
}
