import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { storeUpload, verifyBlob } from "../../src/lib/server/blob-store.ts";
import { closeDatabase, openDatabase } from "../../src/lib/server/database.ts";
import { createPractice } from "../../src/lib/server/practices.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    closeDatabase(directory);
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("content-addressed store", () => {
  it("scrive il file per hash e normalizza un nome proveniente da Windows", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-blob-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Pratica sintetica");
    const file = new File(["contenuto immutabile"], "C:\\documenti\\visura.txt", {
      type: "text/plain",
    });
    const stored = await storeUpload(database, practice.id, file, directory);
    await expect(verifyBlob(directory, stored.blobPath, stored.sha256)).resolves.toBeUndefined();
    expect(readFileSync(join(directory, stored.blobPath), "utf8")).toBe("contenuto immutabile");
    const row = database
      .prepare("SELECT original_name FROM documents WHERE id = ?")
      .get(stored.id) as {
      original_name: string;
    };
    expect(row.original_name).toBe("visura.txt");
  });
});
