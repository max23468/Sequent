import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type Database from "better-sqlite3";
import Sqlite from "better-sqlite3";

interface BackupEntry {
  path: string;
  bytes: number;
  sha256: string;
}

async function checksum(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function inventory(root: string, current = root): Promise<BackupEntry[]> {
  const entries: BackupEntry[] = [];
  for (const name of await readdir(current)) {
    if (name === "manifest.json") continue;
    const absolutePath = join(current, name);
    const metadata = await stat(absolutePath);
    if (metadata.isDirectory()) entries.push(...(await inventory(root, absolutePath)));
    if (metadata.isFile()) {
      entries.push({
        path: relative(root, absolutePath),
        bytes: metadata.size,
        sha256: await checksum(absolutePath),
      });
    }
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

export async function createBaseBackup(
  database: Database.Database,
  dataDirectory: string,
  destinationDirectory: string,
): Promise<string> {
  await mkdir(destinationDirectory, { recursive: true, mode: 0o700 });
  const finalPath = join(
    destinationDirectory,
    `sequent-backup-${new Date().toISOString().replaceAll(":", "-")}`,
  );
  const temporaryPath = join(destinationDirectory, `.backup-${randomUUID()}`);
  await mkdir(temporaryPath, { recursive: false, mode: 0o700 });
  try {
    const databaseBackupPath = join(temporaryPath, "sequent.sqlite");
    await database.backup(databaseBackupPath);
    const sanitizedDatabase = new Sqlite(databaseBackupPath);
    try {
      sanitizedDatabase.exec(
        "DELETE FROM sessions; DELETE FROM owner; DELETE FROM login_attempts; VACUUM;",
      );
    } finally {
      sanitizedDatabase.close();
    }
    const blobSource = join(dataDirectory, "blobs");
    try {
      await cp(blobSource, join(temporaryPath, "blobs"), { recursive: true, errorOnExist: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const files = await inventory(temporaryPath);
    const manifest = {
      format: "sequent-base-backup",
      version: 1,
      createdAt: new Date().toISOString(),
      files,
    };
    await writeFile(
      join(temporaryPath, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { mode: 0o600 },
    );
    await rename(temporaryPath, finalPath);
    return finalPath;
  } catch (error) {
    await rm(temporaryPath, { recursive: true, force: true });
    throw error;
  }
}

export async function verifyBaseBackup(backupPath: string): Promise<void> {
  const manifest = JSON.parse(await readFile(join(backupPath, "manifest.json"), "utf8")) as {
    format: string;
    version: number;
    files: BackupEntry[];
  };
  if (manifest.format !== "sequent-base-backup" || manifest.version !== 1)
    throw new Error("BACKUP_FORMAT_INVALID");
  for (const entry of manifest.files) {
    if (entry.path.startsWith("/") || entry.path.split("/").includes(".."))
      throw new Error("BACKUP_PATH_INVALID");
    const path = join(backupPath, entry.path);
    const metadata = await stat(path);
    if (metadata.size !== entry.bytes || (await checksum(path)) !== entry.sha256)
      throw new Error("BACKUP_HASH_MISMATCH");
  }
}
