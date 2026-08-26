import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, type Stats } from "node:fs";
import { link, mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getDataDirectory, MAX_UPLOAD_BYTES } from "./config.ts";

const STALE_UPLOAD_GRACE_MS = 6 * 60 * 60 * 1_000;

export interface PersistedUpload {
  sha256: string;
  byteSize: number;
  blobPath: string;
  originalName: string;
  mediaType: string;
}

export interface PersistedArtifact {
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

async function hashLocalFile(path: string): Promise<{ sha256: string; byteSize: number }> {
  const metadata = await stat(path);
  if (!metadata.isFile()) throw new Error("ARTIFACT_NOT_FILE");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return { sha256: hash.digest("hex"), byteSize: metadata.size };
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

export async function cleanupStaleUploads(
  dataDirectory = getDataDirectory(),
  now = Date.now(),
): Promise<number> {
  const temporaryDirectory = join(dataDirectory, "tmp");
  let names: string[];
  try {
    names = await readdir(temporaryDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }

  let removed = 0;
  for (const name of names) {
    if (!name.endsWith(".upload")) continue;
    const path = join(temporaryDirectory, name);
    let metadata: Stats;
    try {
      metadata = await stat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (!metadata.isFile() || now - metadata.mtimeMs < STALE_UPLOAD_GRACE_MS) continue;
    await rm(path, { force: true });
    removed += 1;
  }
  return removed;
}

export async function persistUpload(
  file: File,
  dataDirectory = getDataDirectory(),
  onDirectorySynced?: (directoryPath: string) => void | Promise<void>,
): Promise<PersistedUpload> {
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
    const safeOriginalName = file.name.replaceAll("\\", "/").split("/").at(-1) || "documento";
    return {
      sha256,
      byteSize,
      blobPath,
      originalName: basename(safeOriginalName),
      mediaType: file.type || "application/octet-stream",
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

export function resolveBlobPath(dataDirectory: string, blobPath: string): string {
  const root = resolve(dataDirectory);
  const absolutePath = resolve(root, blobPath);
  const relation = relative(root, absolutePath);
  if (relation.startsWith("..") || relation === "" || relation.includes("\0")) {
    throw new Error("BLOB_PATH_INVALID");
  }
  return absolutePath;
}

export async function persistGeneratedArtifact(
  sourcePath: string,
  dataDirectory = getDataDirectory(),
): Promise<PersistedArtifact> {
  const { sha256, byteSize } = await hashLocalFile(sourcePath);
  const blobPath = join("blobs", sha256.slice(0, 2), sha256.slice(2));
  await persistUploadedBlob(sourcePath, join(dataDirectory, blobPath), sha256);
  return { sha256, byteSize, blobPath };
}

export async function persistResumableUpload(
  sourcePath: string,
  originalName: string,
  mediaType: string,
  expectedSize: number,
  dataDirectory = getDataDirectory(),
): Promise<PersistedUpload> {
  const { sha256, byteSize } = await hashLocalFile(sourcePath);
  if (byteSize !== expectedSize) throw new Error("UPLOAD_SIZE_MISMATCH");
  const temporaryDirectory = join(dataDirectory, "tmp");
  await mkdir(temporaryDirectory, { recursive: true, mode: 0o700 });
  const adoptionPath = join(temporaryDirectory, `${randomUUID()}.upload`);
  await link(sourcePath, adoptionPath);
  const blobPath = join("blobs", sha256.slice(0, 2), sha256.slice(2));
  try {
    await persistUploadedBlob(adoptionPath, join(dataDirectory, blobPath), sha256);
  } catch (error) {
    await rm(adoptionPath, { force: true });
    throw error;
  }
  return {
    sha256,
    byteSize,
    blobPath,
    originalName: basename(originalName.replaceAll("\\", "/").split("/").at(-1) || "documento"),
    mediaType: mediaType || "application/octet-stream",
  };
}
