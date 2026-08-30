import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
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
const centralDirectorySignature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
const endOfCentralDirectorySignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);

function centralDirectoryOffsets(archive: Buffer): number[] {
  const offsets: number[] = [];
  for (let offset = archive.indexOf(centralDirectorySignature); offset >= 0;) {
    offsets.push(offset);
    offset = archive.indexOf(centralDirectorySignature, offset + 4);
  }
  return offsets;
}

function forgeEntryCount(archive: Uint8Array, entries: number): Buffer {
  const forged = Buffer.from(archive);
  const end = forged.lastIndexOf(endOfCentralDirectorySignature);
  if (end < 0) throw new Error("END_OF_CENTRAL_DIRECTORY_NOT_FOUND");
  forged.writeUInt16LE(entries, end + 8);
  forged.writeUInt16LE(entries, end + 10);
  return forged;
}

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
  it("rifiuta archivi con count, espansione o rapporto di compressione anomali", async () => {
    const root = mkdtempSync(join(tmpdir(), "sequent-backup-archive-limits-"));
    directories.push(root);
    const backup = join(root, "limiti.zip");
    const base = zipSync({
      "manifest.json": Buffer.from("{}"),
      "sequent.sqlite": Buffer.from("fixture"),
    });

    writeFileSync(backup, forgeEntryCount(base, 10_001));
    await expect(verifyBaseBackup(backup)).rejects.toThrow("BACKUP_ARCHIVE_ENTRY_LIMIT");

    const ratio = Buffer.from(base);
    const firstCentral = centralDirectoryOffsets(ratio)[0];
    if (firstCentral === undefined) throw new Error("CENTRAL_DIRECTORY_NOT_FOUND");
    ratio.writeUInt32LE(101 * 1024 * 1024, firstCentral + 24);
    writeFileSync(backup, ratio);
    await expect(verifyBaseBackup(backup)).rejects.toThrow(
      "BACKUP_ARCHIVE_COMPRESSION_RATIO_LIMIT",
    );

    const expanded = Buffer.from(base);
    const centralEntries = centralDirectoryOffsets(expanded);
    expect(centralEntries).toHaveLength(2);
    for (const central of centralEntries) {
      expanded.writeUInt32LE(1_200_000_000, central + 24);
      expanded.writeUInt32LE(20_000_000, central + 20);
    }
    writeFileSync(backup, expanded);
    await expect(verifyBaseBackup(backup)).rejects.toThrow("BACKUP_ARCHIVE_EXPANDED_SIZE_LIMIT");

    const streamMismatch = Buffer.from(base);
    const streamCentral = centralDirectoryOffsets(streamMismatch)[0];
    if (streamCentral === undefined) throw new Error("CENTRAL_DIRECTORY_NOT_FOUND");
    streamMismatch.writeUInt32LE(1, streamCentral + 24);
    writeFileSync(backup, streamMismatch);
    await expect(verifyBaseBackup(backup)).rejects.toThrow("BACKUP_ARCHIVE_ENTRY_SIZE_LIMIT");
    expect(readdirSync(root).some((name) => name.startsWith(".backup-extract-"))).toBe(false);
  });

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
        `INSERT INTO login_attempts(attempt_key, failed_count, blocked_until, updated_at)
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
