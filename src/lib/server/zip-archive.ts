import { createWriteStream } from "node:fs";
import { lstat, mkdir, open, statfs } from "node:fs/promises";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Open, type CentralDirectory, type File as ZipEntry } from "unzipper-esm";

const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const END_OF_CENTRAL_DIRECTORY_BYTES = 22;
const MAX_ZIP_COMMENT_BYTES = 65_535;

export interface ZipArchiveLimits {
  errorPrefix: "ARCHIVE" | "BACKUP_ARCHIVE";
  maxArchiveBytes: number;
  maxEntries: number;
  maxExpandedBytes: number;
  maxEntryBytes: number;
  maxCompressionRatio: number;
  compressionRatioMinimumBytes: number;
  minimumFreeBytes?: number;
  extractionCopies?: number;
}

interface StreamBudget {
  total: number;
}

function failure(limits: ZipArchiveLimits, code: string): Error {
  return new Error(`${limits.errorPrefix}_${code}`);
}

function safeEntryPath(path: string): string | null {
  const normalized = path.replaceAll("\\", "/");
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    isAbsolute(normalized) ||
    /^[A-Za-z]:/u.test(normalized) ||
    normalized.includes("\0") ||
    normalized.split("/").includes("..")
  ) {
    return null;
  }
  return normalized;
}

async function readDeclaredEntryCount(
  path: string,
  limits: ZipArchiveLimits,
): Promise<{ archiveBytes: number; entries: number }> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw failure(limits, "FORMAT_INVALID");
  if (metadata.size > limits.maxArchiveBytes) throw failure(limits, "COMPRESSED_SIZE_LIMIT");
  const tailLength = Math.min(
    metadata.size,
    END_OF_CENTRAL_DIRECTORY_BYTES + MAX_ZIP_COMMENT_BYTES,
  );
  if (tailLength < END_OF_CENTRAL_DIRECTORY_BYTES) throw failure(limits, "FORMAT_INVALID");

  const handle = await open(path, "r");
  try {
    const tail = Buffer.allocUnsafe(tailLength);
    const { bytesRead } = await handle.read(tail, 0, tailLength, metadata.size - tailLength);
    if (bytesRead !== tailLength) throw failure(limits, "FORMAT_INVALID");
    let offset = -1;
    for (let index = tail.length - END_OF_CENTRAL_DIRECTORY_BYTES; index >= 0; index -= 1) {
      if (tail.readUInt32LE(index) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
        offset = index;
        break;
      }
    }
    if (offset < 0) throw failure(limits, "FORMAT_INVALID");
    const diskNumber = tail.readUInt16LE(offset + 4);
    const centralDirectoryDisk = tail.readUInt16LE(offset + 6);
    const diskEntries = tail.readUInt16LE(offset + 8);
    const totalEntries = tail.readUInt16LE(offset + 10);
    const centralDirectoryBytes = tail.readUInt32LE(offset + 12);
    const centralDirectoryOffset = tail.readUInt32LE(offset + 16);
    const commentBytes = tail.readUInt16LE(offset + 20);
    const absoluteOffset = metadata.size - tailLength + offset;
    if (
      diskNumber !== 0 ||
      centralDirectoryDisk !== 0 ||
      diskEntries !== totalEntries ||
      totalEntries === 0xffff ||
      centralDirectoryBytes === 0xffffffff ||
      centralDirectoryOffset === 0xffffffff ||
      absoluteOffset + END_OF_CENTRAL_DIRECTORY_BYTES + commentBytes !== metadata.size ||
      centralDirectoryOffset + centralDirectoryBytes > absoluteOffset
    ) {
      throw failure(limits, "FORMAT_INVALID");
    }
    if (totalEntries > limits.maxEntries) throw failure(limits, "ENTRY_LIMIT");
    return { archiveBytes: metadata.size, entries: totalEntries };
  } finally {
    await handle.close();
  }
}

function validateEntry(
  entry: ZipEntry,
  limits: ZipArchiveLimits,
): { normalizedPath: string; expandedBytes: number; compressedBytes: number } {
  const normalizedPath = safeEntryPath(entry.path);
  const expandedBytes = entry.uncompressedSize;
  const compressedBytes = entry.compressedSize;
  const unixType = (entry.externalFileAttributes >>> 16) & 0o170000;
  if (!normalizedPath || unixType === 0o120000) throw failure(limits, "PATH_INVALID");
  if ((entry.flags & 0x1) !== 0) throw failure(limits, "ENCRYPTED");
  if (![0, 8].includes(entry.compressionMethod)) throw failure(limits, "COMPRESSION_UNSUPPORTED");
  if (
    !Number.isSafeInteger(expandedBytes) ||
    !Number.isSafeInteger(compressedBytes) ||
    expandedBytes < 0 ||
    compressedBytes < 0
  ) {
    throw failure(limits, "SIZE_INVALID");
  }
  if (expandedBytes > limits.maxEntryBytes) throw failure(limits, "ENTRY_SIZE_LIMIT");
  if (
    expandedBytes >= limits.compressionRatioMinimumBytes &&
    (compressedBytes === 0 || expandedBytes / compressedBytes > limits.maxCompressionRatio)
  ) {
    throw failure(limits, "COMPRESSION_RATIO_LIMIT");
  }
  return { normalizedPath, expandedBytes, compressedBytes };
}

export async function inspectZipArchive(
  path: string,
  limits: ZipArchiveLimits,
): Promise<CentralDirectory> {
  const declared = await readDeclaredEntryCount(path, limits);
  const archive = await Open.file(path);
  if (
    archive.numberOfRecords !== declared.entries ||
    archive.files.length !== declared.entries ||
    archive.files.length > limits.maxEntries
  ) {
    throw failure(limits, "ENTRY_LIMIT");
  }
  const paths = new Set<string>();
  let expandedTotal = 0;
  let compressedTotal = 0;
  for (const entry of archive.files) {
    const validated = validateEntry(entry, limits);
    if (paths.has(validated.normalizedPath)) throw failure(limits, "DUPLICATE_PATH");
    paths.add(validated.normalizedPath);
    expandedTotal += validated.expandedBytes;
    compressedTotal += validated.compressedBytes;
    if (!Number.isSafeInteger(expandedTotal) || expandedTotal > limits.maxExpandedBytes)
      throw failure(limits, "EXPANDED_SIZE_LIMIT");
  }
  if (
    expandedTotal >= limits.compressionRatioMinimumBytes &&
    (compressedTotal === 0 || expandedTotal / compressedTotal > limits.maxCompressionRatio)
  ) {
    throw failure(limits, "COMPRESSION_RATIO_LIMIT");
  }
  if (declared.archiveBytes <= 0) throw failure(limits, "FORMAT_INVALID");
  return archive;
}

async function consumeEntry(
  entry: ZipEntry,
  limits: ZipArchiveLimits,
  budget: StreamBudget,
  destination?: string,
): Promise<Buffer | undefined> {
  let entryBytes = 0;
  const chunks: Buffer[] = [];
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      entryBytes += chunk.byteLength;
      budget.total += chunk.byteLength;
      if (entryBytes > entry.uncompressedSize || entryBytes > limits.maxEntryBytes)
        callback(failure(limits, "ENTRY_SIZE_LIMIT"));
      else if (budget.total > limits.maxExpandedBytes)
        callback(failure(limits, "EXPANDED_SIZE_LIMIT"));
      else {
        if (!destination) chunks.push(Buffer.from(chunk));
        callback(null, chunk);
      }
    },
  });
  if (destination) {
    try {
      await pipeline(
        entry.stream(),
        counter,
        createWriteStream(destination, { flags: "wx", mode: 0o600 }),
      );
    } catch (error) {
      if (error instanceof Error && error.message.startsWith(`${limits.errorPrefix}_`)) throw error;
      throw failure(limits, "STREAM_INVALID");
    }
  } else {
    try {
      await pipeline(
        entry.stream(),
        counter,
        new Transform({
          transform(_chunk, _encoding, cb) {
            cb();
          },
        }),
      );
    } catch (error) {
      if (error instanceof Error && error.message.startsWith(`${limits.errorPrefix}_`)) throw error;
      throw failure(limits, "STREAM_INVALID");
    }
  }
  if (entryBytes !== entry.uncompressedSize) throw failure(limits, "SIZE_MISMATCH");
  return destination ? undefined : Buffer.concat(chunks, entryBytes);
}

export async function verifyZipArchive(path: string, limits: ZipArchiveLimits): Promise<void> {
  const archive = await inspectZipArchive(path, limits);
  const budget = { total: 0 };
  for (const entry of archive.files) {
    if (entry.type === "File") await consumeEntry(entry, limits, budget);
  }
}

export async function readZipEntry(
  archive: CentralDirectory,
  entryPath: string,
  limits: ZipArchiveLimits,
  maxBytes: number,
): Promise<Buffer> {
  const entry = archive.files.find(
    (candidate) => candidate.type === "File" && candidate.path.replaceAll("\\", "/") === entryPath,
  );
  if (!entry || entry.uncompressedSize > maxBytes) throw failure(limits, "ENTRY_SIZE_LIMIT");
  const scopedLimits = { ...limits, maxEntryBytes: Math.min(limits.maxEntryBytes, maxBytes) };
  return (await consumeEntry(entry, scopedLimits, { total: 0 })) ?? Buffer.alloc(0);
}

export async function extractZipArchive(
  path: string,
  destination: string,
  limits: ZipArchiveLimits,
): Promise<void> {
  const archive = await inspectZipArchive(path, limits);
  const expandedBytes = archive.files.reduce((total, entry) => total + entry.uncompressedSize, 0);
  if (limits.minimumFreeBytes !== undefined) {
    const storage = await statfs(destination, { bigint: true });
    const availableBytes = storage.bavail * storage.bsize;
    const requiredBytes =
      BigInt(expandedBytes) * BigInt(limits.extractionCopies ?? 1) +
      BigInt(limits.minimumFreeBytes);
    if (availableBytes < requiredBytes) throw failure(limits, "DISK_SPACE_LIMIT");
  }
  const root = resolve(destination);
  const budget = { total: 0 };
  for (const entry of archive.files) {
    const normalized = safeEntryPath(entry.path);
    if (!normalized) throw failure(limits, "PATH_INVALID");
    const target = resolve(root, normalized);
    if (target !== root && !target.startsWith(`${root}${sep}`))
      throw failure(limits, "PATH_INVALID");
    if (entry.type === "Directory") {
      await mkdir(target, { recursive: true, mode: 0o700 });
      continue;
    }
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await consumeEntry(entry, limits, budget, target);
  }
}
