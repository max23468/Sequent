import { statfsSync } from "node:fs";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getDataDirectory } from "$lib/server/config";
import { openDatabase } from "$lib/server/database";
import { isStorageHealthy } from "$lib/server/health";

export const GET: RequestHandler = ({ url }) => {
  let healthy: boolean;
  if (url.searchParams.get("scope") === "storage") {
    const storage = statfsSync(getDataDirectory(), { bigint: true });
    healthy = isStorageHealthy(storage);
  } else {
    const database = openDatabase();
    healthy = database.pragma("quick_check", { simple: true }) === "ok";
  }

  return json({ status: healthy ? "ok" : "degraded" }, { status: healthy ? 200 : 503 });
};
