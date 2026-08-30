import { statfsSync } from "node:fs";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getDataDirectory } from "$lib/server/config";
import { openDatabase } from "$lib/server/database";
import { isDatabaseResponsive, isStorageHealthy } from "$lib/server/health";

export const GET: RequestHandler = ({ url }) => {
  let healthy: boolean;
  if (url.searchParams.get("scope") === "storage") {
    const storage = statfsSync(getDataDirectory(), { bigint: true });
    healthy = isStorageHealthy(storage);
  } else {
    healthy = isDatabaseResponsive(openDatabase());
  }

  return json({ status: healthy ? "ok" : "degraded" }, { status: healthy ? 200 : 503 });
};
