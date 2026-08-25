import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { openDatabase } from "$lib/server/database";

export const GET: RequestHandler = () => {
  const database = openDatabase();
  const integrity = database.pragma("quick_check", { simple: true });
  const sqliteVersion = (
    database.prepare("SELECT sqlite_version() AS version").get() as { version: string }
  ).version;
  const healthy = integrity === "ok";
  return json(
    { status: healthy ? "ok" : "degraded", sqliteVersion },
    { status: healthy ? 200 : 503 },
  );
};
