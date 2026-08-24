import type { Handle } from "@sveltejs/kit";
import { openDatabase } from "$lib/server/database";
import { readSession, SESSION_COOKIE } from "$lib/server/auth";
import { recoverInterruptedJobs } from "$lib/server/jobs";
import { startJobRunner } from "$lib/server/job-runner";

let initialized = false;

export const handle: Handle = async ({ event, resolve }) => {
  const database = openDatabase();
  if (!initialized) {
    recoverInterruptedJobs(database);
    startJobRunner(database);
    initialized = true;
  }
  const session = readSession(database, event.cookies.get(SESSION_COOKIE));
  event.locals.ownerId = session?.ownerId ?? null;
  event.locals.sessionId = session?.id ?? null;
  return resolve(event, {
    filterSerializedResponseHeaders: (name) => name === "content-type",
  });
};
