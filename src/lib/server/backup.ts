import { createHash, randomUUID } from "node:crypto";
import { createReadStream, type Stats } from "node:fs";
import { cp, lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
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
    const metadata = await lstat(absolutePath);
    if (metadata.isSymbolicLink()) throw new Error("BACKUP_SYMLINK_INVALID");
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
      sanitizedDatabase.pragma("journal_mode = DELETE");
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
  if ((await lstat(backupPath)).isSymbolicLink()) throw new Error("BACKUP_SYMLINK_INVALID");
  const manifest = JSON.parse(await readFile(join(backupPath, "manifest.json"), "utf8")) as {
    format: string;
    version: number;
    files: BackupEntry[];
  };
  if (manifest.format !== "sequent-base-backup" || manifest.version !== 1)
    throw new Error("BACKUP_FORMAT_INVALID");
  const declaredPaths = manifest.files.map(({ path }) => path);
  if (
    !declaredPaths.includes("sequent.sqlite") ||
    new Set(declaredPaths).size !== declaredPaths.length
  )
    throw new Error("BACKUP_INVENTORY_INVALID");
  const actualFiles = await inventory(backupPath);
  if (
    actualFiles.length !== manifest.files.length ||
    actualFiles.some((entry, index) => entry.path !== manifest.files[index]?.path)
  )
    throw new Error("BACKUP_INVENTORY_MISMATCH");
  for (const entry of manifest.files) {
    if (entry.path.startsWith("/") || entry.path.split("/").includes(".."))
      throw new Error("BACKUP_PATH_INVALID");
    const path = join(backupPath, entry.path);
    const metadata = await stat(path);
    if (metadata.size !== entry.bytes || (await checksum(path)) !== entry.sha256)
      throw new Error("BACKUP_HASH_MISMATCH");
  }
  const database = new Sqlite(join(backupPath, "sequent.sqlite"), {
    readonly: true,
    fileMustExist: true,
  });
  try {
    if (database.pragma("quick_check", { simple: true }) !== "ok")
      throw new Error("BACKUP_DATABASE_INVALID");
    for (const table of ["owner", "sessions", "login_attempts"] as const) {
      const row = database.prepare(`SELECT count(*) AS count FROM ${table}`).get() as {
        count: number;
      };
      if (row.count !== 0) throw new Error("BACKUP_CREDENTIALS_PRESENT");
    }
    const documents = database
      .prepare("SELECT blob_path, byte_size, sha256 FROM documents")
      .all() as Array<{ blob_path: string; byte_size: number; sha256: string }>;
    for (const document of documents) {
      if (
        isAbsolute(document.blob_path) ||
        !document.blob_path.startsWith("blobs/") ||
        document.blob_path.split("/").includes("..")
      ) {
        throw new Error("BACKUP_BLOB_PATH_INVALID");
      }
      const blobPath = join(backupPath, document.blob_path);
      let metadata: Stats;
      try {
        metadata = await stat(blobPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          throw new Error("BACKUP_BLOB_MISSING");
        throw error;
      }
      if (
        !metadata.isFile() ||
        metadata.size !== document.byte_size ||
        (await checksum(blobPath)) !== document.sha256
      ) {
        throw new Error("BACKUP_BLOB_MISMATCH");
      }
    }
  } finally {
    database.close();
  }
}

export async function restoreBaseBackup(
  backupPath: string,
  dataDirectory: string,
  options: { replace?: boolean } = {},
): Promise<{ dataDirectory: string; previousDataDirectory: string | null }> {
  const source = resolve(backupPath);
  const target = resolve(dataDirectory);
  if (
    source === target ||
    source.startsWith(`${target}${sep}`) ||
    target.startsWith(`${source}${sep}`)
  )
    throw new Error("BACKUP_TARGET_OVERLAP");
  await verifyBaseBackup(source);

  const parent = dirname(target);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const temporary = join(parent, `.sequent-restore-${randomUUID()}`);
  const previous = join(parent, `.sequent-before-restore-${randomUUID()}`);
  await mkdir(temporary, { mode: 0o700 });
  try {
    await cp(join(source, "sequent.sqlite"), join(temporary, "sequent.sqlite"), {
      errorOnExist: true,
    });
    try {
      await cp(join(source, "blobs"), join(temporary, "blobs"), {
        recursive: true,
        errorOnExist: true,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const restoredDatabase = new Sqlite(join(temporary, "sequent.sqlite"), {
      readonly: true,
      fileMustExist: true,
    });
    try {
      if (restoredDatabase.pragma("quick_check", { simple: true }) !== "ok")
        throw new Error("RESTORE_DATABASE_INVALID");
    } finally {
      restoredDatabase.close();
    }

    let targetExists = true;
    try {
      await stat(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      targetExists = false;
    }
    if (targetExists && !options.replace) throw new Error("RESTORE_TARGET_EXISTS");
    if (!targetExists) {
      await rename(temporary, target);
      return { dataDirectory: target, previousDataDirectory: null };
    }

    await rename(target, previous);
    try {
      await rename(temporary, target);
    } catch (error) {
      await rename(previous, target);
      throw error;
    }
    return { dataDirectory: target, previousDataDirectory: previous };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}
