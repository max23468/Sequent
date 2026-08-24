import { createHash } from "node:crypto";

import { assertSafeArchivePath, parseDizArchive, rewriteArchiveEntry } from "./archive.ts";
import {
  catalogFieldForMapping,
  qualifiedMappingFor,
  type QualifiedDizFieldMapping,
} from "./qualified-mappings.ts";
import {
  parseXstreamDiz,
  rewriteXstreamFields,
  type DizField,
  type DizFieldLocator,
} from "./xstream.ts";

export { compareDizFields, type ThreeWayFieldComparison } from "./three-way.ts";
export {
  QUALIFIED_DIZ_FIELD_MAPPINGS,
  catalogFieldForMapping,
  qualifiedMappingFor,
  type QualifiedDizFieldMapping,
} from "./qualified-mappings.ts";

export type DizFieldChange = DizFieldLocator & {
  readonly expectedValue: string;
  readonly value: string;
};

export type ParsedDiz = {
  readonly format: "xstream-zip-v1";
  readonly bytes: number;
  readonly sha256: string;
  readonly entryCount: number;
  readonly xmlEntryName: string;
  readonly xmlBytes: number;
  readonly fields: readonly DizField[];
  readonly attachments: readonly {
    name: string;
    bytes: number;
    kind: "pdf" | "tiff" | "jpeg" | "png" | "unknown";
    sha256: string;
    referenced: boolean;
  }[];
  readonly source: ReturnType<typeof parseDizArchive>;
  readonly xstream: ReturnType<typeof parseXstreamDiz>;
};

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function attachmentKind(content: Buffer): ParsedDiz["attachments"][number]["kind"] {
  if (content.subarray(0, 4).toString("ascii") === "%PDF") return "pdf";
  if (content.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00]))) return "tiff";
  if (content.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]))) return "tiff";
  if (content.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "jpeg";
  if (content.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return "png";
  return "unknown";
}

export function parseDiz(input: Uint8Array): ParsedDiz {
  const archive = parseDizArchive(input);
  const xmlCandidates = archive.entries.filter((entry) =>
    entry.content.subarray(0, 256).toString("utf8").trimStart().startsWith("<"),
  );
  if (xmlCandidates.length !== 1) {
    throw new Error("DIZ non supportato: attesa esattamente una entry XML");
  }
  const xmlEntry = xmlCandidates[0]!;
  const xstream = parseXstreamDiz(xmlEntry.content);
  const attachmentNames = new Set(
    archive.entries.filter((entry) => entry !== xmlEntry).map((entry) => entry.name),
  );
  for (const reference of xstream.attachmentReferences) {
    assertSafeArchivePath(reference);
    if (!attachmentNames.has(reference)) {
      throw new Error("DIZ non valido: riferimento a un allegato assente");
    }
  }
  const references = new Set(xstream.attachmentReferences);
  const attachments = archive.entries
    .filter((entry) => entry !== xmlEntry)
    .map((entry) => ({
      name: entry.name,
      bytes: entry.content.length,
      kind: attachmentKind(entry.content),
      sha256: sha256(entry.content),
      referenced: references.has(entry.name),
    }));
  if (attachments.some((attachment) => !attachment.referenced)) {
    throw new Error("DIZ non valido: allegato orfano non referenziato");
  }
  return {
    format: "xstream-zip-v1",
    bytes: archive.bytes.length,
    sha256: sha256(archive.bytes),
    entryCount: archive.entries.length,
    xmlEntryName: xmlEntry.name,
    xmlBytes: xmlEntry.content.length,
    fields: xstream.fields,
    attachments,
    source: archive,
    xstream,
  };
}

function assertQualifiedChange(change: DizFieldChange): QualifiedDizFieldMapping {
  const mapping = qualifiedMappingFor(change);
  const expectedCode = `${change.quadro}${change.field}`;
  if (
    mapping?.status !== "qualified" ||
    mapping.dizCode !== expectedCode ||
    !mapping.catalogFieldId ||
    !mapping.officialPath.startsWith("/") ||
    !mapping.sourceIds.includes("SRC-08")
  ) {
    throw new Error("DIZ writer bloccato: mapping ufficiale non qualificato");
  }
  const catalogField = catalogFieldForMapping(mapping);
  if ([...change.value].length > catalogField.maxLength) {
    throw new Error(
      `DIZ writer bloccato: valore oltre il limite ufficiale di ${catalogField.maxLength} caratteri`,
    );
  }
  return mapping;
}

export function rewriteDizFields(input: Uint8Array, changes: readonly DizFieldChange[]): Buffer {
  if (changes.length === 0) return Buffer.from(input);
  for (const change of changes) assertQualifiedChange(change);
  const parsed = parseDiz(input);
  const updatedXml = rewriteXstreamFields(parsed.xstream, changes);
  return rewriteArchiveEntry(parsed.source, parsed.xmlEntryName, updatedXml);
}
