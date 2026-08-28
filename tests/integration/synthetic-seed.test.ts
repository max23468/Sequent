import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, openDatabase } from "../../src/lib/server/database.ts";
import { listCalculationRuns, listDevolutionScenarios } from "../../src/lib/server/domain.ts";
import {
  ensureSyntheticPractice,
  removeSyntheticPractice,
} from "../../src/lib/server/synthetic-seed.ts";
import { getPractice } from "../../src/lib/server/practices.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    closeDatabase(directory);
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("pratica sintetica di installazione", () => {
  it("crea una sola pratica dimostrativa completa e la rimuove in modo mirato", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-synthetic-seed-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const first = ensureSyntheticPractice(database);
    const second = ensureSyntheticPractice(database);
    expect(first.created).toBe(true);
    expect(second).toEqual({ practiceId: first.practiceId, created: false });
    const practice = getPractice(database, first.practiceId)!;
    expect(practice.title).toContain("ESEMPIO SINTETICO");
    expect(listDevolutionScenarios(database, practice.id, practice.declarationId)[0]?.status).toBe(
      "confirmed",
    );
    expect(listCalculationRuns(database, practice.id, practice.declarationId)).toHaveLength(1);
    expect(removeSyntheticPractice(database)).toBe(true);
    expect(removeSyntheticPractice(database)).toBe(false);
    expect(getPractice(database, first.practiceId)).toBeNull();
  });
});
