import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, openDatabase } from "../../src/lib/server/database.ts";
import {
  createReviewItem,
  decideReviewItem,
  listReviewItems,
} from "../../src/lib/server/documents.ts";
import { createPractice } from "../../src/lib/server/practices.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    closeDatabase(directory);
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("decisioni di revisione", () => {
  it("non ricrea una proposta sopra una correzione manuale autorevole", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-review-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Pratica revisione");
    const firstId = createReviewItem(database, {
      practiceId: practice.id,
      subjectKey: "document.reference",
      label: "Riferimento",
      proposedValue: "AB-12",
      method: "codex",
      confidence: 0.8,
    });
    expect(
      decideReviewItem(database, practice.id, firstId, {
        status: "edited",
        value: "AB-21",
      }),
    ).toBe(true);

    const secondId = createReviewItem(database, {
      practiceId: practice.id,
      subjectKey: "document.reference",
      label: "Riferimento",
      proposedValue: "AB-99",
      method: "codex",
      confidence: 0.99,
    });

    expect(secondId).toBe(firstId);
    expect(listReviewItems(database, practice.id)).toEqual([]);
    expect(listReviewItems(database, practice.id, "all")).toEqual([
      expect.objectContaining({ status: "edited", decidedValue: "AB-21" }),
    ]);
  });
});
