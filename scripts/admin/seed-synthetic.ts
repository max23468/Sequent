import { getDataDirectory } from "../../src/lib/server/config.ts";
import { closeDatabase, openDatabase } from "../../src/lib/server/database.ts";
import {
  ensureSyntheticPractice,
  removeSyntheticPractice,
} from "../../src/lib/server/synthetic-seed.ts";

const dataDirectory = getDataDirectory();
try {
  const database = openDatabase(dataDirectory);
  if (process.argv.includes("--remove")) {
    console.log(
      removeSyntheticPractice(database)
        ? "Pratica sintetica rimossa."
        : "Nessuna pratica sintetica da rimuovere.",
    );
  } else {
    const result = ensureSyntheticPractice(database);
    console.log(
      result.created
        ? `Pratica sintetica creata: ${result.practiceId}`
        : `Pratica sintetica già presente: ${result.practiceId}`,
    );
  }
} finally {
  closeDatabase(dataDirectory);
}
