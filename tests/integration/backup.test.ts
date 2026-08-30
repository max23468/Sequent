import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createBaseBackup,
  restoreBaseBackup,
  verifyBaseBackup,
} from "../../src/lib/server/backup.ts";
import { closeDatabase, openDatabase } from "../../src/lib/server/database.ts";
import { ingestDocument } from "../../src/lib/server/document-ingestion.ts";
import { createPractice } from "../../src/lib/server/practices.ts";
import { createOwner, issueSession } from "../../src/lib/server/auth.ts";
import Sqlite from "better-sqlite3";
import { zipSync } from "fflate";
import { Open } from "unzipper-esm";

const directories: string[] = [];

async function backupEntries(path: string): Promise<Record<string, Uint8Array>> {
  const archive = await Open.file(path);
  return Object.fromEntries(
    await Promise.all(
      archive.files
        .filter((entry) => entry.type === "File")
        .map(async (entry) => [entry.path, new Uint8Array(await entry.buffer())] as const),
    ),
  );
}

async function rewriteBackup(
  path: string,
  mutate: (entries: Record<string, Uint8Array>) => void | Promise<void>,
): Promise<void> {
  const entries = await backupEntries(path);
  await mutate(entries);
  writeFileSync(path, zipSync(entries));
}

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
    const ownerId = await createOwner(database, "Sviluppo", "SequentSviluppoSicuro2026");
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
    expect(backup).toMatch(/\.zip$/u);
    await expect(verifyBaseBackup(backup)).resolves.toBeUndefined();
    const entries = await backupEntries(backup);
    const snapshotPath = join(root, "snapshot.sqlite");
    writeFileSync(snapshotPath, entries["sequent.sqlite"]!);
    const snapshot = new Sqlite(snapshotPath, { readonly: true });
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
    await rewriteBackup(backup, (entries) => {
      const manifest = JSON.parse(Buffer.from(entries["manifest.json"]!).toString("utf8")) as {
        files: Array<{ path: string }>;
      };
      manifest.files = manifest.files.filter(({ path }) => path !== "sequent.sqlite");
      entries["manifest.json"] = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    });
    await expect(verifyBaseBackup(backup)).rejects.toThrow("BACKUP_INVENTORY_INVALID");

    const validBackup = await createBaseBackup(database, dataDirectory, join(root, "backups-2"));
    await rewriteBackup(validBackup, (entries) => {
      entries["non-inventariato.txt"] = Buffer.from("contenuto estraneo");
    });
    await expect(verifyBaseBackup(validBackup)).rejects.toThrow("BACKUP_INVENTORY_MISMATCH");
  });

  it("rifiuta un archivio verificabile che contiene credenziali", async () => {
    const root = mkdtempSync(join(tmpdir(), "sequent-backup-credentials-"));
    directories.push(root);
    const dataDirectory = join(root, "data");
    const database = openDatabase(dataDirectory);
    createPractice(database, "Pratica senza credenziali nel backup");
    const backup = await createBaseBackup(database, dataDirectory, join(root, "backups"));
    const entries = await backupEntries(backup);
    const databasePath = join(root, "credentials.sqlite");
    writeFileSync(databasePath, entries["sequent.sqlite"]!);
    const snapshot = new Sqlite(databasePath);
    snapshot
      .prepare(
        `INSERT INTO owner(
           id, username, username_normalized, password_hash, created_at, password_changed_at
         ) VALUES ('owner-iniettato', 'Utente', 'utente', 'hash', ?, ?)`,
      )
      .run(new Date().toISOString(), new Date().toISOString());
    snapshot.close();
    const manifest = JSON.parse(Buffer.from(entries["manifest.json"]!).toString("utf8")) as {
      files: Array<{ path: string; bytes: number; sha256: string }>;
    };
    const entry = manifest.files.find(({ path }) => path === "sequent.sqlite")!;
    entry.bytes = statSync(databasePath).size;
    entry.sha256 = createHash("sha256").update(readFileSync(databasePath)).digest("hex");
    entries["sequent.sqlite"] = readFileSync(databasePath);
    entries["manifest.json"] = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    writeFileSync(backup, zipSync(entries));
    await expect(verifyBaseBackup(backup)).rejects.toThrow("BACKUP_CREDENTIALS_PRESENT");
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

  it("ripristina in una directory nuova e conserva separatamente la base sostituita", async () => {
    const root = mkdtempSync(join(tmpdir(), "sequent-restore-"));
    directories.push(root);
    const sourceDirectory = join(root, "source");
    const sourceDatabase = openDatabase(sourceDirectory);
    createPractice(sourceDatabase, "Pratica da ripristinare");
    const backup = await createBaseBackup(sourceDatabase, sourceDirectory, join(root, "backups"));
    closeDatabase(sourceDirectory);

    const targetDirectory = join(root, "target");
    const firstRestore = await restoreBaseBackup(backup, targetDirectory);
    expect(firstRestore.previousDataDirectory).toBeNull();
    const restored = openDatabase(targetDirectory);
    expect((restored.prepare("SELECT title FROM practices").get() as { title: string }).title).toBe(
      "Pratica da ripristinare",
    );
    closeDatabase(targetDirectory);

    const replacement = openDatabase(targetDirectory);
    createPractice(replacement, "Dato da preservare nel rollback");
    closeDatabase(targetDirectory);
    await expect(restoreBaseBackup(backup, targetDirectory)).rejects.toThrow(
      "RESTORE_TARGET_EXISTS",
    );
    const secondRestore = await restoreBaseBackup(backup, targetDirectory, { replace: true });
    expect(secondRestore.previousDataDirectory).not.toBeNull();
    const previous = new Sqlite(join(secondRestore.previousDataDirectory!, "sequent.sqlite"), {
      readonly: true,
    });
    expect(
      (
        previous
          .prepare("SELECT count(*) AS count FROM practices WHERE title = ?")
          .get("Dato da preservare nel rollback") as { count: number }
      ).count,
    ).toBe(1);
    previous.close();
  });
});
