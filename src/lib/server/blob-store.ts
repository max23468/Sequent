import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { link, mkdir, open, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type Database from "better-sqlite3";
import { getDataDirectory, MAX_UPLOAD_BYTES } from "./config.ts";

export interface StoredDocument {
  id: string;
  sha256: string;
  byteSize: number;
  blobPath: string;
}

async function syncDirectory(directoryPath: string): Promise<void> {
  const handle = await open(directoryPath, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function storeUpload(
  database: Database.Database,
  practiceId: string,
  file: File,
  dataDirectory = getDataDirectory(),
  onDirectorySynced?: (directoryPath: string) => void | Promise<void>,
): Promise<StoredDocument> {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("FILE_TOO_LARGE");
  if (file.size === 0) throw new Error("EMPTY_FILE");
  const temporaryDirectory = join(dataDirectory, "tmp");
  await mkdir(temporaryDirectory, { recursive: true, mode: 0o700 });
  const temporaryPath = join(temporaryDirectory, `${randomUUID()}.upload`);
  const hash = createHash("sha256");
  let byteSize = 0;
  const source = file.stream();
  const destination = createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 });
  const reader = source.getReader();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteSize += chunk.value.byteLength;
      if (byteSize > MAX_UPLOAD_BYTES) throw new Error("FILE_TOO_LARGE");
      hash.update(chunk.value);
      if (!destination.write(chunk.value)) {
        await new Promise<void>((resolve) => destination.once("drain", resolve));
      }
    }
    await new Promise<void>((resolve, reject) =>
      destination.end((error?: Error | null) => (error ? reject(error) : resolve())),
    );
    const handle = await open(temporaryPath, "r");
    await handle.sync();
    await handle.close();

    const sha256 = hash.digest("hex");
    const blobPath = join("blobs", sha256.slice(0, 2), sha256.slice(2));
    const absoluteBlobPath = join(dataDirectory, blobPath);
    const existing = database
      .prepare(
        `SELECT id, sha256, byte_size, blob_path
         FROM documents WHERE practice_id = ? AND sha256 = ?`,
      )
      .get(practiceId, sha256) as
      | { id: string; sha256: string; byte_size: number; blob_path: string }
      | undefined;
    if (existing) {
      await rm(temporaryPath, { force: true });
      return {
        id: existing.id,
        sha256: existing.sha256,
        byteSize: existing.byte_size,
        blobPath: existing.blob_path,
      };
    }
    await mkdir(dirname(absoluteBlobPath), { recursive: true, mode: 0o700 });
    try {
      await link(temporaryPath, absoluteBlobPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    await syncDirectory(dirname(absoluteBlobPath));
    await onDirectorySynced?.(dirname(absoluteBlobPath));
    await rm(temporaryPath, { force: true });

    const id = randomUUID();
    const now = new Date().toISOString();
    const safeOriginalName = file.name.replaceAll("\\", "/").split("/").at(-1) || "documento";
    const insert = database
      .prepare(
        `INSERT OR IGNORE INTO documents(id, practice_id, original_name, media_type, byte_size, sha256, blob_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        practiceId,
        basename(safeOriginalName),
        file.type || "application/octet-stream",
        byteSize,
        sha256,
        blobPath,
        now,
      );
    if (insert.changes === 1) {
      database.prepare("UPDATE practices SET updated_at = ? WHERE id = ?").run(now, practiceId);
      return { id, sha256, byteSize, blobPath };
    }
    const concurrentDuplicate = database
      .prepare(
        `SELECT id, sha256, byte_size, blob_path
         FROM documents WHERE practice_id = ? AND sha256 = ?`,
      )
      .get(practiceId, sha256) as {
      id: string;
      sha256: string;
      byte_size: number;
      blob_path: string;
    };
    return {
      id: concurrentDuplicate.id,
      sha256: concurrentDuplicate.sha256,
      byteSize: concurrentDuplicate.byte_size,
      blobPath: concurrentDuplicate.blob_path,
    };
  } catch (error) {
    destination.destroy();
    await rm(temporaryPath, { force: true });
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export async function verifyBlob(
  dataDirectory: string,
  blobPath: string,
  expectedHash: string,
): Promise<void> {
  const absolutePath = join(dataDirectory, blobPath);
  const metadata = await stat(absolutePath);
  if (!metadata.isFile()) throw new Error("BLOB_NOT_FILE");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(absolutePath)) hash.update(chunk);
  if (hash.digest("hex") !== expectedHash) throw new Error("BLOB_HASH_MISMATCH");
}
