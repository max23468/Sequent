import { resetOwnerCredentials } from "../../src/lib/server/auth.ts";
import { closeDatabase, openDatabase } from "../../src/lib/server/database.ts";

const dataDirectory = process.env.SEQUENT_E2E_DATA_DIR;
if (!dataDirectory) throw new Error("SEQUENT_E2E_DATA_DIR_REQUIRED");

try {
  await resetOwnerCredentials(openDatabase(dataDirectory), "Sviluppo", "SequentSviluppoSicuro2026");
} finally {
  closeDatabase(dataDirectory);
}
