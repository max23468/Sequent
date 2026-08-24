import { inflateRawSync, deflateRawSync } from "node:zlib";

const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const DATA_DESCRIPTOR_FLAG = 0x0008;
const ENCRYPTED_FLAG = 0x0001;
const EOCD_SIGNATURE = 0x06054b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const UTF8_FLAG = 0x0800;
const ZIP64_SENTINEL_16 = 0xffff;
const ZIP64_SENTINEL_32 = 0xffffffff;

export const MAX_DIZ_COMPRESSED_BYTES = 40 * 1024 * 1024;
export const MAX_DIZ_EXPANDED_BYTES = 200 * 1024 * 1024;

export type DizArchiveEntry = {
  readonly name: string;
  readonly content: Buffer;
  readonly contentCrc32: number;
  readonly compressedContent: Buffer;
  readonly compressionMethod: 0 | 8;
  readonly flags: number;
  readonly localOffset: number;
  readonly rawCentralRecord: Buffer;
  readonly rawLocalRecord: Buffer;
};

export type DizArchive = {
  readonly bytes: Buffer;
  readonly entries: readonly DizArchiveEntry[];
  readonly rawEocd: Buffer;
};

function assertRange(bytes: Buffer, offset: number, length: number, label: string): void {
  if (offset < 0 || length < 0 || offset + length > bytes.length) {
    throw new Error(`DIZ ZIP non valido: ${label} fuori dai limiti`);
  }
}

function decodeEntryName(bytes: Buffer, flags: number): string {
  if ((flags & UTF8_FLAG) !== 0) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error("DIZ ZIP non valido: nome entry UTF-8 non valido");
    }
  }

  if (bytes.some((value) => value > 0x7f)) {
    throw new Error("DIZ ZIP non supportato: nome entry non UTF-8 e non ASCII");
  }
  return bytes.toString("ascii");
}

export function assertSafeArchivePath(name: string): void {
  const normalized = name.replaceAll("\\", "/");
  const parts = normalized.split("/");
  if (
    name.length === 0 ||
    name.includes("\0") ||
    name.includes("\\") ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    parts.some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`DIZ ZIP non valido: percorso entry non sicuro`);
  }
}

function findEocd(bytes: Buffer): number {
  const minimumOffset = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimumOffset; offset -= 1) {
    if (bytes.readUInt32LE(offset) !== EOCD_SIGNATURE) continue;
    const commentLength = bytes.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === bytes.length) return offset;
  }
  throw new Error("DIZ ZIP non valido: directory centrale assente");
}

function parseCentralEntries(
  bytes: Buffer,
  centralOffset: number,
  centralSize: number,
  entryCount: number,
): Array<{
  name: string;
  flags: number;
  compressionMethod: 0 | 8;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
  rawCentralRecord: Buffer;
}> {
  const entries = [];
  const names = new Set<string>();
  let cursor = centralOffset;

  for (let index = 0; index < entryCount; index += 1) {
    assertRange(bytes, cursor, 46, "header directory centrale");
    if (bytes.readUInt32LE(cursor) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error("DIZ ZIP non valido: firma della directory centrale inattesa");
    }

    const flags = bytes.readUInt16LE(cursor + 8);
    const compressionMethodValue = bytes.readUInt16LE(cursor + 10);
    const crc32 = bytes.readUInt32LE(cursor + 16);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const diskStart = bytes.readUInt16LE(cursor + 34);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const recordLength = 46 + nameLength + extraLength + commentLength;
    assertRange(bytes, cursor, recordLength, "record directory centrale");

    if ((flags & ENCRYPTED_FLAG) !== 0) {
      throw new Error("DIZ ZIP non supportato: entry cifrata");
    }
    if (compressionMethodValue !== 0 && compressionMethodValue !== 8) {
      throw new Error(`DIZ ZIP non supportato: metodo di compressione ${compressionMethodValue}`);
    }
    const compressionMethod: 0 | 8 = compressionMethodValue;
    if (
      compressedSize === ZIP64_SENTINEL_32 ||
      uncompressedSize === ZIP64_SENTINEL_32 ||
      localOffset === ZIP64_SENTINEL_32 ||
      diskStart === ZIP64_SENTINEL_16
    ) {
      throw new Error("DIZ ZIP non supportato: ZIP64");
    }

    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = decodeEntryName(nameBytes, flags);
    assertSafeArchivePath(name);
    if (names.has(name)) throw new Error("DIZ ZIP non valido: nome entry duplicato");
    names.add(name);

    entries.push({
      name,
      flags,
      compressionMethod,
      crc32,
      compressedSize,
      uncompressedSize,
      localOffset,
      rawCentralRecord: Buffer.from(bytes.subarray(cursor, cursor + recordLength)),
    });
    cursor += recordLength;
  }

  if (cursor !== centralOffset + centralSize) {
    throw new Error("DIZ ZIP non valido: dimensione della directory centrale incoerente");
  }
  return entries;
}

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function parseDizArchive(input: Uint8Array): DizArchive {
  const bytes = Buffer.from(input);
  if (bytes.length > MAX_DIZ_COMPRESSED_BYTES) {
    throw new Error("DIZ ZIP non valido: supera il limite compresso di 40 MiB");
  }
  if (bytes.length < 22) throw new Error("DIZ ZIP non valido: file troppo corto");

  const eocdOffset = findEocd(bytes);
  const disk = bytes.readUInt16LE(eocdOffset + 4);
  const centralDisk = bytes.readUInt16LE(eocdOffset + 6);
  const diskEntries = bytes.readUInt16LE(eocdOffset + 8);
  const totalEntries = bytes.readUInt16LE(eocdOffset + 10);
  const centralSize = bytes.readUInt32LE(eocdOffset + 12);
  const centralOffset = bytes.readUInt32LE(eocdOffset + 16);

  if (disk !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) {
    throw new Error("DIZ ZIP non supportato: archivio multi-disco");
  }
  if (
    totalEntries === ZIP64_SENTINEL_16 ||
    centralSize === ZIP64_SENTINEL_32 ||
    centralOffset === ZIP64_SENTINEL_32
  ) {
    throw new Error("DIZ ZIP non supportato: ZIP64");
  }
  if (centralOffset + centralSize !== eocdOffset) {
    throw new Error("DIZ ZIP non valido: offset della directory centrale incoerente");
  }

  const centralEntries = parseCentralEntries(bytes, centralOffset, centralSize, totalEntries);
  const entriesByLocalOffset = [...centralEntries].sort(
    (left, right) => left.localOffset - right.localOffset,
  );
  if (entriesByLocalOffset[0]?.localOffset !== 0) {
    throw new Error("DIZ ZIP non supportato: prefisso prima delle entry");
  }

  const rawLocalRecords = new Map<string, Buffer>();
  let expandedBytes = 0;
  for (let index = 0; index < entriesByLocalOffset.length; index += 1) {
    const entry = entriesByLocalOffset[index]!;
    const nextOffset = entriesByLocalOffset[index + 1]?.localOffset ?? centralOffset;
    assertRange(bytes, entry.localOffset, 30, "header locale");
    if (bytes.readUInt32LE(entry.localOffset) !== LOCAL_FILE_SIGNATURE) {
      throw new Error("DIZ ZIP non valido: firma locale inattesa");
    }

    const localFlags = bytes.readUInt16LE(entry.localOffset + 6);
    const localMethod = bytes.readUInt16LE(entry.localOffset + 8);
    const localNameLength = bytes.readUInt16LE(entry.localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(entry.localOffset + 28);
    const dataOffset = entry.localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataOffset + entry.compressedSize;
    assertRange(bytes, entry.localOffset, nextOffset - entry.localOffset, "record locale");
    assertRange(bytes, dataOffset, entry.compressedSize, "contenuto compresso");
    if (dataEnd > nextOffset) throw new Error("DIZ ZIP non valido: entry sovrapposte");
    if (localFlags !== entry.flags || localMethod !== entry.compressionMethod) {
      throw new Error("DIZ ZIP non valido: header locale e centrale divergenti");
    }

    const localName = decodeEntryName(
      bytes.subarray(entry.localOffset + 30, entry.localOffset + 30 + localNameLength),
      localFlags,
    );
    if (localName !== entry.name) {
      throw new Error("DIZ ZIP non valido: nome locale e centrale divergenti");
    }

    rawLocalRecords.set(entry.name, Buffer.from(bytes.subarray(entry.localOffset, nextOffset)));
    expandedBytes += entry.uncompressedSize;
  }

  if (expandedBytes > MAX_DIZ_EXPANDED_BYTES) {
    throw new Error("DIZ ZIP non valido: contenuto espanso oltre il limite di sicurezza");
  }

  const entries = centralEntries.map((entry) => {
    const localRecord = rawLocalRecords.get(entry.name)!;
    const localNameLength = localRecord.readUInt16LE(26);
    const localExtraLength = localRecord.readUInt16LE(28);
    const dataOffset = 30 + localNameLength + localExtraLength;
    const compressedContent = Buffer.from(
      localRecord.subarray(dataOffset, dataOffset + entry.compressedSize),
    );
    let content: Buffer;
    try {
      content =
        entry.compressionMethod === 0
          ? Buffer.from(compressedContent)
          : inflateRawSync(compressedContent, { maxOutputLength: entry.uncompressedSize });
    } catch {
      throw new Error(`DIZ ZIP non valido: decompressione fallita`);
    }
    if (content.length !== entry.uncompressedSize || crc32(content) !== entry.crc32) {
      throw new Error("DIZ ZIP non valido: CRC o dimensione dell'entry incoerenti");
    }
    return {
      name: entry.name,
      content,
      contentCrc32: entry.crc32,
      compressedContent,
      compressionMethod: entry.compressionMethod,
      flags: entry.flags,
      localOffset: entry.localOffset,
      rawCentralRecord: entry.rawCentralRecord,
      rawLocalRecord: localRecord,
    } satisfies DizArchiveEntry;
  });

  return { bytes, entries, rawEocd: Buffer.from(bytes.subarray(eocdOffset)) };
}

function rebuildLocalRecord(
  entry: DizArchiveEntry,
  content: Buffer,
): {
  bytes: Buffer;
  crc: number;
  compressedSize: number;
} {
  const nameLength = entry.rawLocalRecord.readUInt16LE(26);
  const extraLength = entry.rawLocalRecord.readUInt16LE(28);
  const headerLength = 30 + nameLength + extraLength;
  const header = Buffer.from(entry.rawLocalRecord.subarray(0, headerLength));
  const compressed = entry.compressionMethod === 0 ? content : deflateRawSync(content);
  const crc = crc32(content);
  const flags = entry.flags & ~DATA_DESCRIPTOR_FLAG;
  header.writeUInt16LE(flags, 6);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(content.length, 22);
  return { bytes: Buffer.concat([header, compressed]), crc, compressedSize: compressed.length };
}

export function rewriteArchiveEntry(
  archive: DizArchive,
  entryName: string,
  content: Uint8Array,
): Buffer {
  const replacement = Buffer.from(content);
  const selected = archive.entries.find((entry) => entry.name === entryName);
  if (!selected) throw new Error("DIZ ZIP non valido: entry da riscrivere assente");
  if (selected.content.equals(replacement)) return Buffer.from(archive.bytes);
  const expandedBytes = archive.entries.reduce(
    (total, entry) => total + (entry === selected ? replacement.length : entry.content.length),
    0,
  );
  if (expandedBytes > MAX_DIZ_EXPANDED_BYTES) {
    throw new Error("DIZ ZIP non valido: contenuto espanso oltre il limite di sicurezza");
  }

  const localOrder = [...archive.entries].sort(
    (left, right) => left.localOffset - right.localOffset,
  );
  const localOffsets = new Map<string, number>();
  const localRecords: Buffer[] = [];
  const replacementMetadata = new Map<
    string,
    { crc: number; compressedSize: number; flags: number }
  >();
  let cursor = 0;
  for (const entry of localOrder) {
    localOffsets.set(entry.name, cursor);
    const record =
      entry.name === entryName
        ? rebuildLocalRecord(entry, replacement)
        : { bytes: entry.rawLocalRecord };
    localRecords.push(record.bytes);
    if (entry.name === entryName && "crc" in record) {
      replacementMetadata.set(entry.name, {
        crc: record.crc,
        compressedSize: record.compressedSize,
        flags: entry.flags & ~DATA_DESCRIPTOR_FLAG,
      });
    }
    cursor += record.bytes.length;
  }

  const centralOffset = cursor;
  const centralRecords = archive.entries.map((entry) => {
    const record = Buffer.from(entry.rawCentralRecord);
    const metadata = replacementMetadata.get(entry.name);
    if (metadata) {
      record.writeUInt16LE(metadata.flags, 8);
      record.writeUInt32LE(metadata.crc, 16);
      record.writeUInt32LE(metadata.compressedSize, 20);
      record.writeUInt32LE(replacement.length, 24);
    }
    record.writeUInt32LE(localOffsets.get(entry.name)!, 42);
    return record;
  });
  const centralSize = centralRecords.reduce((total, record) => total + record.length, 0);
  const eocd = Buffer.from(archive.rawEocd);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  const output = Buffer.concat([...localRecords, ...centralRecords, eocd]);
  if (output.length > MAX_DIZ_COMPRESSED_BYTES) {
    throw new Error("DIZ ZIP non valido: supera il limite compresso di 40 MiB");
  }
  return output;
}
