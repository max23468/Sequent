import { existsSync } from "node:fs";
import { join } from "node:path";

export const DEPLOYMENT_MAINTENANCE_MARKER = ".deployment-maintenance";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export function blocksMutationDuringDeployment(method: string, dataDirectory: string) {
  return (
    !safeMethods.has(method.toUpperCase()) &&
    existsSync(join(dataDirectory, DEPLOYMENT_MAINTENANCE_MARKER))
  );
}
