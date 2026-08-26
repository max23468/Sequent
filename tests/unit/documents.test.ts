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
import { ingestDocument } from "../../src/lib/server/document-ingestion.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    closeDatabase(directory);
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("decisioni di revisione", () => {
  it("protegge una decisione autorevole anche quando cambia il documento fonte", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-review-source-change-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const first = await ingestDocument(
      database,
      new File(["Fonte A"], "prima.txt", { type: "text/plain" }),
      { newPracticeTitle: "Pratica cambio fonte" },
      directory,
    );
    const second = await ingestDocument(
      database,
      new File(["Fonte B"], "seconda.txt", { type: "text/plain" }),
      { practiceId: first.practiceId },
      directory,
    );
    const firstId = createReviewItem(database, {
      practiceId: first.practiceId,
      documentId: first.id,
      subjectKey: "person.owner.tax-code",
      label: "Codice fiscale",
      proposedValue: "AAA",
      method: "codex",
    });
    expect(
      decideReviewItem(database, first.practiceId, firstId, {
        status: "edited",
        value: "AUTOREVOLE",
      }),
    ).toBe(true);

    const secondId = createReviewItem(database, {
      practiceId: first.practiceId,
      documentId: second.id,
      subjectKey: "person.owner.tax-code",
      label: "Codice fiscale",
      proposedValue: "BBB",
      method: "codex",
    });

    expect(secondId).toBe(firstId);
    expect(listReviewItems(database, first.practiceId)).toEqual([]);
    expect(listReviewItems(database, first.practiceId, "all")).toEqual([
      expect.objectContaining({
        id: firstId,
        documentId: first.id,
        status: "edited",
        decidedValue: "AUTOREVOLE",
      }),
    ]);
  });

  it("non conferma un conflitto senza un valore autorevole", () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-review-conflict-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Pratica conflitto");
    const itemId = createReviewItem(database, {
      practiceId: practice.id,
      subjectKey: "document.conflict",
      label: "Valore discordante",
      proposedValue: null,
      alternatives: ["A", "B"],
      method: "codex",
    });

    expect(
      decideReviewItem(database, practice.id, itemId, { status: "confirmed", value: null }),
    ).toBe(false);
    expect(listReviewItems(database, practice.id)).toEqual([
      expect.objectContaining({ id: itemId, status: "pending", decidedValue: null }),
    ]);
  });

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
