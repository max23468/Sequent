import { resolve } from "node:path";
import Database from "better-sqlite3";
import { repairImportedDizAcquisition } from "../../src/lib/server/official-flow.ts";

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

if (!process.argv.includes("--apply"))
  throw new Error("DIZ_REPAIR_APPLY_REQUIRED: aggiungi --apply dopo avere verificato il backup.");
const dataDirectory = argument("--data-dir") ?? process.env.SEQUENT_DATA_DIR;
if (!dataDirectory) throw new Error("Usa --data-dir <directory-dati>.");
const expectedCount = Number.parseInt(argument("--expected-count") ?? "5", 10);
if (!Number.isSafeInteger(expectedCount) || expectedCount < 1)
  throw new Error("DIZ_REPAIR_EXPECTED_COUNT_INVALID");

const database = new Database(resolve(dataDirectory, "sequent.sqlite"), { fileMustExist: true });
try {
  const artifacts = database
    .prepare(
      `SELECT artifacts.id, artifacts.practice_id
       FROM official_artifacts AS artifacts
       JOIN practices ON practices.id = artifacts.practice_id
       WHERE artifacts.kind = 'diz-imported' AND practices.status = 'active'
         AND artifacts.created_at = (
           SELECT max(candidate.created_at)
           FROM official_artifacts AS candidate
           WHERE candidate.kind = 'diz-imported'
             AND candidate.practice_id = artifacts.practice_id
             AND candidate.declaration_id = artifacts.declaration_id
         )
       ORDER BY artifacts.created_at, artifacts.id`,
    )
    .all() as Array<{ id: string; practice_id: string }>;
  if (artifacts.length !== expectedCount)
    throw new Error(`DIZ_REPAIR_COUNT_MISMATCH:${artifacts.length}:${expectedCount}`);

  const results = [];
  for (const artifact of artifacts) {
    const acquisition = await repairImportedDizAcquisition(database, {
      practiceId: artifact.practice_id,
      artifactId: artifact.id,
      dataDirectory,
    });
    results.push({
      mappedFields: acquisition.mappedFields,
      integratedFields: acquisition.importedFields + acquisition.unchangedFields,
      preservedFields: acquisition.preservedFields,
      conflicts: acquisition.conflictingFields,
      missingTargets: acquisition.missingTargets,
      createdSubjects: acquisition.createdSubjects,
      createdAssets: acquisition.createdAssets,
      createdDecedent: acquisition.createdDecedent,
      synchronizedSubjectEntries: acquisition.synchronizedSubjectEntries,
      synchronizedSharedSubjects: acquisition.synchronizedSharedSubjects,
      subjectIdentityConflicts: acquisition.subjectIdentityConflicts,
    });
  }
  process.stdout.write(
    `${JSON.stringify({ format: "sequent-diz-acquisition-repair", version: 1, repaired: results.length, results })}\n`,
  );
} finally {
  database.close();
}
