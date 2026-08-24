import { readFileSync } from "node:fs";
import { closeDatabase, openDatabase } from "../../src/lib/server/database.ts";
import { storeUpload } from "../../src/lib/server/blob-store.ts";
import { createPractice } from "../../src/lib/server/practices.ts";
import { startJobRunner } from "../../src/lib/server/job-runner.ts";
import { claimNextJob, enqueueJob, recoverInterruptedJobs } from "../../src/lib/server/jobs.ts";

const phase = process.argv[2];
const dataDirectory = process.argv[3];
if (!phase || !dataDirectory) throw new Error("JOB_RESTART_ARGUMENTS_REQUIRED");
process.env.SEQUENT_DATA_DIR = dataDirectory;

const database = openDatabase(dataDirectory);

if (phase === "interrupt") {
  const practice = createPractice(database, "Riavvio sintetico");
  const document = await storeUpload(
    database,
    practice.id,
    new File(["contenuto persistente"], "riavvio.txt", { type: "text/plain" }),
    dataDirectory,
  );
  const job = enqueueJob(
    database,
    "foundation.verify_blob",
    { sha256: document.sha256 },
    { practiceId: practice.id, documentId: document.id },
  );
  const claimed = claimNextJob(database);
  if (claimed?.id !== job.id || claimed.status !== "running")
    throw new Error("JOB_NOT_INTERRUPTED");
  closeDatabase(dataDirectory);
  process.stdout.write(job.id);
} else if (phase === "resume") {
  const jobId = readFileSync(process.argv[4]!, "utf8").trim();
  recoverInterruptedJobs(database);
  startJobRunner(database);
  const deadline = Date.now() + 5_000;
  let row: { status: string; attempts: number; error_code: string | null } | undefined;
  while (Date.now() < deadline) {
    row = database
      .prepare("SELECT status, attempts, error_code FROM jobs WHERE id = ?")
      .get(jobId) as typeof row;
    if (row?.status === "completed") break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  closeDatabase(dataDirectory);
  process.stdout.write(JSON.stringify(row));
} else {
  closeDatabase(dataDirectory);
  throw new Error("JOB_RESTART_PHASE_UNKNOWN");
}
