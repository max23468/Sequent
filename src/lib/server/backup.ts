import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createReadStream, createWriteStream, type Stats } from "node:fs";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type Database from "better-sqlite3";
import { Zip, ZipPassThrough } from "fflate";
import Sqlite from "better-sqlite3";
import { MIN_HEALTHY_FREE_BYTES } from "./health.ts";
import {
  extractZipArchive,
  inspectZipArchive,
  readZipEntry,
  type ZipArchiveLimits,
} from "./zip-archive.ts";

const BACKUP_ARCHIVE_LIMITS = {
  errorPrefix: "BACKUP_ARCHIVE",
  maxArchiveBytes: 2 * 1024 * 1024 * 1024,
  maxEntries: 10_000,
  maxExpandedBytes: 2 * 1024 * 1024 * 1024,
  maxEntryBytes: 2 * 1024 * 1024 * 1024,
  maxCompressionRatio: 100,
  compressionRatioMinimumBytes: 100 * 1024 * 1024,
  minimumFreeBytes: Number(MIN_HEALTHY_FREE_BYTES),
  extractionCopies: 2,
} satisfies ZipArchiveLimits;

interface BackupEntry {
  path: string;
  bytes: number;
  sha256: string;
}

interface BackupManifest {
  format: string;
  version: number;
  createdAt: string;
  files: BackupEntry[];
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

async function writeZipArchive(source: string, destination: string): Promise<void> {
  const entries = await inventory(source);
  const manifestPath = join(source, "manifest.json");
  const manifestMetadata = await stat(manifestPath);
  entries.push({
    path: "manifest.json",
    bytes: manifestMetadata.size,
    sha256: await checksum(manifestPath),
  });
  entries.sort((left, right) => left.path.localeCompare(right.path));
  const output = createWriteStream(destination, { flags: "wx", mode: 0o600 });
  let archiveError: Error | null = null;
  let drain: Promise<unknown> = Promise.resolve();
  const completed = new Promise<void>((resolveCompleted, rejectCompleted) => {
    output.once("close", resolveCompleted);
    output.once("error", rejectCompleted);
  });
  const archive = new Zip((error, chunk, final) => {
    if (error) {
      archiveError = error;
      output.destroy(error);
      return;
    }
    if (chunk.length > 0 && !output.write(chunk)) drain = once(output, "drain");
    if (final) output.end();
  });
  try {
    for (const entry of entries) {
      const zipEntry = new ZipPassThrough(entry.path.split(sep).join("/"));
      archive.add(zipEntry);
      for await (const chunk of createReadStream(join(source, entry.path))) {
        zipEntry.push(new Uint8Array(chunk as Buffer));
        await drain;
        if (archiveError) throw archiveError;
      }
      zipEntry.push(new Uint8Array(), true);
      await drain;
      if (archiveError) throw archiveError;
    }
    archive.end();
    await completed;
  } catch (error) {
    archive.terminate();
    output.destroy();
    throw error;
  }
}

async function materializeBackup(
  backupPath: string,
): Promise<{ directory: string; cleanup: () => Promise<void> }> {
  const metadata = await lstat(backupPath);
  if (metadata.isSymbolicLink()) throw new Error("BACKUP_SYMLINK_INVALID");
  if (metadata.isDirectory()) return { directory: backupPath, cleanup: async () => {} };
  if (!metadata.isFile()) throw new Error("BACKUP_FORMAT_INVALID");
  const temporary = await mkdtemp(join(dirname(resolve(backupPath)), ".backup-extract-"));
  try {
    await extractZipArchive(backupPath, temporary, BACKUP_ARCHIVE_LIMITS);
    return {
      directory: temporary,
      cleanup: () => rm(temporary, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

export async function createBaseBackup(
  database: Database.Database,
  dataDirectory: string,
  destinationDirectory: string,
): Promise<string> {
  await mkdir(destinationDirectory, { recursive: true, mode: 0o700 });
  const finalPath = join(
    destinationDirectory,
    `sequent-backup-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}.zip`,
  );
  const temporaryPath = join(destinationDirectory, `.backup-${randomUUID()}`);
  const temporaryArchive = join(destinationDirectory, `.backup-${randomUUID()}.zip`);
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
    const manifest: BackupManifest = {
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
    await writeZipArchive(temporaryPath, temporaryArchive);
    await rename(temporaryArchive, finalPath);
    await rm(temporaryPath, { recursive: true, force: true });
    return finalPath;
  } catch (error) {
    await rm(temporaryPath, { recursive: true, force: true });
    await rm(temporaryArchive, { force: true });
    throw error;
  }
}

async function verifyBackupDirectory(backupPath: string): Promise<BackupManifest> {
  const manifest = JSON.parse(
    await readFile(join(backupPath, "manifest.json"), "utf8"),
  ) as BackupManifest;
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
    const blobReferences = database
      .prepare(
        `SELECT 'documents' AS source, blob_path, byte_size, sha256 FROM documents
         UNION ALL
         SELECT 'document_artifacts', blob_path, byte_size, sha256 FROM document_artifacts
         UNION ALL
         SELECT 'official_attachments', blob_path, byte_size, sha256 FROM official_attachments
         UNION ALL
         SELECT 'official_artifacts', blob_path, byte_size, sha256 FROM official_artifacts`,
      )
      .all() as Array<{ source: string; blob_path: string; byte_size: number; sha256: string }>;
    for (const reference of blobReferences) {
      if (
        isAbsolute(reference.blob_path) ||
        !reference.blob_path.startsWith("blobs/") ||
        reference.blob_path.split("/").includes("..")
      ) {
        throw new Error("BACKUP_BLOB_PATH_INVALID");
      }
      const blobPath = join(backupPath, reference.blob_path);
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
        metadata.size !== reference.byte_size ||
        (await checksum(blobPath)) !== reference.sha256
      ) {
        throw new Error("BACKUP_BLOB_MISMATCH");
      }
    }
  } finally {
    database.close();
  }
  return manifest;
}

export async function verifyBaseBackup(backupPath: string): Promise<void> {
  const materialized = await materializeBackup(backupPath);
  try {
    await verifyBackupDirectory(materialized.directory);
  } finally {
    await materialized.cleanup();
  }
}

export async function readBaseBackupMetadata(
  backupPath: string,
): Promise<Pick<BackupManifest, "format" | "version" | "createdAt">> {
  const metadata = await lstat(backupPath);
  let manifest: BackupManifest;
  if (metadata.isDirectory()) {
    manifest = JSON.parse(
      await readFile(join(backupPath, "manifest.json"), "utf8"),
    ) as BackupManifest;
  } else {
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("BACKUP_FORMAT_INVALID");
    const archive = await inspectZipArchive(backupPath, BACKUP_ARCHIVE_LIMITS);
    manifest = JSON.parse(
      (await readZipEntry(archive, "manifest.json", BACKUP_ARCHIVE_LIMITS, 1024 * 1024)).toString(
        "utf8",
      ),
    ) as BackupManifest;
  }
  if (manifest.format !== "sequent-base-backup" || manifest.version !== 1 || !manifest.createdAt)
    throw new Error("BACKUP_FORMAT_INVALID");
  return { format: manifest.format, version: manifest.version, createdAt: manifest.createdAt };
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
  const materialized = await materializeBackup(source);
  try {
    await verifyBackupDirectory(materialized.directory);

    const parent = dirname(target);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const temporary = join(parent, `.sequent-restore-${randomUUID()}`);
    const previous = join(parent, `.sequent-before-restore-${randomUUID()}`);
    await mkdir(temporary, { mode: 0o700 });
    try {
      await cp(join(materialized.directory, "sequent.sqlite"), join(temporary, "sequent.sqlite"), {
        errorOnExist: true,
      });
      try {
        await cp(join(materialized.directory, "blobs"), join(temporary, "blobs"), {
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
  } finally {
    await materialized.cleanup();
  }
}
