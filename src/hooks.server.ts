import { dev } from "$app/environment";
import type { Handle } from "@sveltejs/kit";
import { openDatabase } from "$lib/server/database";
import {
  ensureDevelopmentOwner,
  issueSession,
  readSession,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "$lib/server/auth";
import {
  getDevelopmentPassword,
  useDevelopmentAutoLogin,
  useSecureCookies,
} from "$lib/server/config";
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
  let session = readSession(database, event.cookies.get(SESSION_COOKIE));
  if (!session && useDevelopmentAutoLogin(dev, event.getClientAddress())) {
    const ownerId = await ensureDevelopmentOwner(database, getDevelopmentPassword());
    const issued = issueSession(database, ownerId);
    event.cookies.set(SESSION_COOKIE, issued.token, {
      ...sessionCookieOptions(),
      httpOnly: true,
      sameSite: "strict",
      secure: useSecureCookies(),
    });
    session = { id: issued.id, ownerId };
  }
  event.locals.ownerId = session?.ownerId ?? null;
  event.locals.sessionId = session?.id ?? null;
  return resolve(event, {
    filterSerializedResponseHeaders: (name) => name === "content-type",
  });
};
