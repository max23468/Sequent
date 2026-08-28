import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  blocksMutationDuringDeployment,
  DEPLOYMENT_MAINTENANCE_MARKER,
} from "../../src/lib/server/deployment-maintenance";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

describe("finestra di manutenzione del deploy", () => {
  it("blocca soltanto richieste mutanti mentre il marker è presente", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-maintenance-"));
    directories.push(directory);

    expect(blocksMutationDuringDeployment("POST", directory)).toBe(false);
    writeFileSync(join(directory, DEPLOYMENT_MAINTENANCE_MARKER), "");

    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(blocksMutationDuringDeployment(method, directory)).toBe(true);
    }
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(blocksMutationDuringDeployment(method, directory)).toBe(false);
    }
  });
});
