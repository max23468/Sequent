import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBaseBackup, verifyBaseBackup } from "../../src/lib/server/backup.ts";
import { closeDatabase, openDatabase } from "../../src/lib/server/database.ts";
import { ingestDocument } from "../../src/lib/server/document-ingestion.ts";
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
    const practice = createPractice(database, "Pratica nel backup");
    const ownerId = await createOwner(database, "SequentSviluppoSicuro2026");
    issueSession(database, ownerId);
    database
      .prepare(
        `INSERT INTO login_attempts(client_key, failed_count, blocked_until, updated_at)
         VALUES ('client-sintetico', 2, NULL, ?)`,
      )
      .run(new Date().toISOString());
    await ingestDocument(
      database,
      new File(["contenuto sintetico"], "fixture.txt", { type: "text/plain" }),
      { practiceId: practice.id },
      dataDirectory,
    );
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
    expect(
      (snapshot.prepare("SELECT count(*) AS count FROM login_attempts").get() as { count: number })
        .count,
    ).toBe(0);
    snapshot.close();
  });

  it("rifiuta manifest incompleti e file non inventariati", async () => {
    const root = mkdtempSync(join(tmpdir(), "sequent-backup-inventory-"));
    directories.push(root);
    const dataDirectory = join(root, "data");
    const database = openDatabase(dataDirectory);
    createPractice(database, "Pratica nel backup incompleto");
    const backup = await createBaseBackup(database, dataDirectory, join(root, "backups"));
    const manifestPath = join(backup, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      files: Array<{ path: string }>;
    };
    manifest.files = manifest.files.filter(({ path }) => path !== "sequent.sqlite");
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await expect(verifyBaseBackup(backup)).rejects.toThrow("BACKUP_INVENTORY_INVALID");

    const validBackup = await createBaseBackup(database, dataDirectory, join(root, "backups-2"));
    writeFileSync(join(validBackup, "non-inventariato.txt"), "contenuto estraneo");
    await expect(verifyBaseBackup(validBackup)).rejects.toThrow("BACKUP_INVENTORY_MISMATCH");
  });

  it("rifiuta blob assenti o corrotti anche se il manifest è internamente coerente", async () => {
    const root = mkdtempSync(join(tmpdir(), "sequent-backup-blobs-"));
    directories.push(root);
    const dataDirectory = join(root, "data");
    const database = openDatabase(dataDirectory);
    const practice = createPractice(database, "Pratica con blob non integro");
    database
      .prepare(
        `INSERT INTO documents(
           id, practice_id, original_name, media_type, byte_size, sha256, blob_path, created_at
         ) VALUES ('missing', ?, 'assente.txt', 'text/plain', 7, 'digest-assente',
                   'blobs/aa/assente', ?)`,
      )
      .run(practice.id, new Date().toISOString());

    const missingBackup = await createBaseBackup(database, dataDirectory, join(root, "missing"));
    await expect(verifyBaseBackup(missingBackup)).rejects.toThrow("BACKUP_BLOB_MISSING");

    const corruptDirectory = join(dataDirectory, "blobs", "bb");
    const corruptPath = join(corruptDirectory, "corrotto");
    await mkdir(corruptDirectory, { recursive: true });
    writeFileSync(corruptPath, "byte corrotti");
    database
      .prepare(
        `INSERT INTO documents(
           id, practice_id, original_name, media_type, byte_size, sha256, blob_path, created_at
         ) VALUES ('corrupt', ?, 'corrotto.txt', 'text/plain', 13, 'digest-atteso',
                   'blobs/bb/corrotto', ?)`,
      )
      .run(practice.id, new Date().toISOString());
    database.prepare("DELETE FROM documents WHERE id = 'missing'").run();

    const corruptBackup = await createBaseBackup(database, dataDirectory, join(root, "corrupt"));
    await expect(verifyBaseBackup(corruptBackup)).rejects.toThrow("BACKUP_BLOB_MISMATCH");
  });
});
