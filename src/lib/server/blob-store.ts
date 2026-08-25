import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { link, mkdir, open, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
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

async function verifyAbsoluteBlob(absolutePath: string, expectedHash: string): Promise<void> {
  const metadata = await stat(absolutePath);
  if (!metadata.isFile()) throw new Error("BLOB_NOT_FILE");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(absolutePath)) hash.update(chunk);
  if (hash.digest("hex") !== expectedHash) throw new Error("BLOB_HASH_MISMATCH");
}

async function persistUploadedBlob(
  temporaryPath: string,
  absoluteBlobPath: string,
  expectedHash: string,
  onDirectorySynced?: (directoryPath: string) => void | Promise<void>,
): Promise<void> {
  const blobDirectory = dirname(absoluteBlobPath);
  await mkdir(blobDirectory, { recursive: true, mode: 0o700 });
  try {
    await verifyAbsoluteBlob(absoluteBlobPath, expectedHash);
    await rm(temporaryPath, { force: true });
    return;
  } catch {
    // Il temporaneo appena sincronizzato è la fonte di ripristino per blob assenti o corrotti.
  }

  const replacementPath = `${absoluteBlobPath}.${randomUUID()}.repair`;
  try {
    await link(temporaryPath, replacementPath);
    await syncDirectory(blobDirectory);
    await rename(replacementPath, absoluteBlobPath);
    await syncDirectory(blobDirectory);
    await onDirectorySynced?.(blobDirectory);
    await rm(temporaryPath, { force: true });
  } catch (error) {
    await rm(replacementPath, { force: true });
    throw error;
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
  try {
    const inspect = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        byteSize += chunk.byteLength;
        if (byteSize > MAX_UPLOAD_BYTES) {
          callback(new Error("FILE_TOO_LARGE"));
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(
      Readable.from(file.stream()),
      inspect,
      createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 }),
    );
    const handle = await open(temporaryPath, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }

    const sha256 = hash.digest("hex");
    const blobPath = join("blobs", sha256.slice(0, 2), sha256.slice(2));
    const absoluteBlobPath = join(dataDirectory, blobPath);
    await persistUploadedBlob(temporaryPath, absoluteBlobPath, sha256, onDirectorySynced);
    const existing = database
      .prepare(
        `SELECT id, sha256, byte_size, blob_path
         FROM documents WHERE practice_id = ? AND sha256 = ?`,
      )
      .get(practiceId, sha256) as
      | { id: string; sha256: string; byte_size: number; blob_path: string }
      | undefined;
    if (existing) {
      return {
        id: existing.id,
        sha256: existing.sha256,
        byteSize: existing.byte_size,
        blobPath: existing.blob_path,
      };
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const safeOriginalName = file.name.replaceAll("\\", "/").split("/").at(-1) || "documento";
    const inserted = database.transaction(() => {
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
      if (insert.changes === 1)
        database.prepare("UPDATE practices SET updated_at = ? WHERE id = ?").run(now, practiceId);
      return insert.changes === 1;
    })();
    if (inserted) {
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
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

export async function verifyBlob(
  dataDirectory: string,
  blobPath: string,
  expectedHash: string,
): Promise<void> {
  await verifyAbsoluteBlob(join(dataDirectory, blobPath), expectedHash);
}
