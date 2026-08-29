import { dev } from "$app/environment";
import type { Handle } from "@sveltejs/kit";
import { openDatabase } from "$lib/server/database";
import { blocksMutationDuringDeployment } from "$lib/server/deployment-maintenance";
import {
  ensureDevelopmentOwner,
  getOwnerUsername,
  issueSession,
  readSession,
  SESSION_COOKIE,
  SESSION_COOKIE_MAX_AGE,
} from "$lib/server/auth";
import { cleanupStaleUploads } from "$lib/server/blob-store";
import {
  getDevelopmentPassword,
  getDevelopmentUsername,
  getDataDirectory,
  useDevelopmentAutoLogin,
  useSecureCookies,
} from "$lib/server/config";
import { recoverInterruptedJobs } from "$lib/server/jobs";
import { startJobRunner } from "$lib/server/job-runner";
import { cleanupExpiredUploadSessions } from "$lib/server/resumable-uploads";

const PRIVATE_ROBOTS_DIRECTIVE = "noindex, nofollow, noarchive, nosnippet, noimageindex";

let initialization: Promise<void> | undefined;

async function initialize() {
  const database = openDatabase();
  await cleanupStaleUploads(getDataDirectory());
  await cleanupExpiredUploadSessions(database);
  recoverInterruptedJobs(database);
  startJobRunner(database);
}

export const handle: Handle = async ({ event, resolve }) => {
  const database = openDatabase();
  initialization ??= initialize();
  await initialization;
  if (blocksMutationDuringDeployment(event.request.method, getDataDirectory())) {
    return new Response(JSON.stringify({ error: "DEPLOYMENT_MAINTENANCE" }), {
      status: 503,
      headers: {
        "content-type": "application/json",
        "retry-after": "30",
      },
    });
  }
  const sessionToken = event.cookies.get(SESSION_COOKIE);
  let session = readSession(database, sessionToken);
  if (session?.renewed && sessionToken) {
    event.cookies.set(SESSION_COOKIE, sessionToken, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: useSecureCookies(),
      maxAge: SESSION_COOKIE_MAX_AGE,
    });
  }
  if (!session && useDevelopmentAutoLogin(dev, event.getClientAddress())) {
    const ownerId = await ensureDevelopmentOwner(
      database,
      getDevelopmentUsername(),
      getDevelopmentPassword(),
    );
    const issued = issueSession(database, ownerId);
    event.cookies.set(SESSION_COOKIE, issued.token, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: useSecureCookies(),
      maxAge: SESSION_COOKIE_MAX_AGE,
    });
    session = {
      id: issued.id,
      ownerId,
      username: getOwnerUsername(database, ownerId),
      renewed: false,
    };
  }
  event.locals.ownerId = session?.ownerId ?? null;
  event.locals.sessionId = session?.id ?? null;
  event.locals.username = session?.username ?? null;
  const response = await resolve(event, {
    filterSerializedResponseHeaders: (name) => name === "content-type",
  });
  response.headers.set("X-Robots-Tag", PRIVATE_ROBOTS_DIRECTIVE);
  return response;
};
