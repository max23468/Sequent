import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBaseBackup, verifyBaseBackup } from "../../src/lib/server/backup.ts";
import { closeDatabase, openDatabase } from "../../src/lib/server/database.ts";
import { createPractice } from "../../src/lib/server/practices.ts";
import { createOwner, issueSession } from "../../src/lib/server/auth.ts";
import Sqlite from "better-sqlite3";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    closeDatabase(directory);
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("backup base", () => {
  it("crea uno snapshot SQLite con inventario verificabile dei blob", async () => {
    const root = mkdtempSync(join(tmpdir(), "sequent-backup-"));
    directories.push(root);
    const dataDirectory = join(root, "data");
    const destination = join(root, "backups");
    const database = openDatabase(dataDirectory);
    createPractice(database, "Pratica nel backup");
    const ownerId = await createOwner(database, "FondazioneM2Sicura2026");
    issueSession(database, ownerId);
    await mkdir(join(dataDirectory, "blobs", "aa"), { recursive: true });
    writeFileSync(join(dataDirectory, "blobs", "aa", "fixture"), "contenuto sintetico");
    const backup = await createBaseBackup(database, dataDirectory, destination);
    await expect(verifyBaseBackup(backup)).resolves.toBeUndefined();
    const snapshot = new Sqlite(join(backup, "sequent.sqlite"), { readonly: true });
    expect(
      (snapshot.prepare("SELECT count(*) AS count FROM practices").get() as { count: number })
        .count,
    ).toBe(1);
    expect(
      (snapshot.prepare("SELECT count(*) AS count FROM owner").get() as { count: number }).count,
    ).toBe(0);
    expect(
      (snapshot.prepare("SELECT count(*) AS count FROM sessions").get() as { count: number }).count,
    ).toBe(0);
    snapshot.close();
  });
});
