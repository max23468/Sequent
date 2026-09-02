import type Database from "better-sqlite3";
import type { ParsedDiz } from "../../domain/diz/index.ts";
import {
  qualifiedOfficialEgDizEvidence,
  SUCCESSIONIONLINE_EG_BUCKETS,
} from "../../domain/successionionline-eg.ts";
import type { ChecklistItem } from "./domain-model.ts";
import { listOfficialAttachments } from "./official-attachments.ts";

interface OfficialEgAttachmentBucket {
  id: string;
  fieldId: string | null;
  label: string;
  recordCode: string;
  checklistItemIds: string[];
  documentIds: string[];
  preparedFileNames: string[];
  preparedSha256: string[];
  count: number;
}

export interface OfficialEgAttachmentState {
  buckets: OfficialEgAttachmentBucket[];
  ambiguousDocumentIds: string[];
  unmappedChecklistItemIds: string[];
  unassignedPreparedDocumentIds: string[];
  ready: boolean;
}

export function buildOfficialEgAttachmentState(
  database: Database.Database,
  practiceId: string,
  checklist: readonly ChecklistItem[],
): OfficialEgAttachmentState {
  const applicable = checklist.filter(
    (item) => item.requirementKind === "attachment" && item.status === "available",
  );
  const unmappedChecklistItemIds = applicable
    .filter((item) => item.officialAttachmentBucket === null)
    .map((item) => item.id);
  const bucketIdsByDocument = new Map<string, Set<string>>();
  for (const item of applicable) {
    if (!item.documentId || !item.officialAttachmentBucket) continue;
    const bucketIds = bucketIdsByDocument.get(item.documentId) ?? new Set<string>();
    bucketIds.add(item.officialAttachmentBucket);
    bucketIdsByDocument.set(item.documentId, bucketIds);
  }
  const ambiguousDocumentIds = [...bucketIdsByDocument]
    .filter(([, bucketIds]) => bucketIds.size > 1)
    .map(([documentId]) => documentId);
  const ambiguous = new Set(ambiguousDocumentIds);
  const prepared = listOfficialAttachments(database, practiceId);
  const assignedDocumentIds = new Set(bucketIdsByDocument.keys());
  const unassignedPreparedDocumentIds = [
    ...new Set(
      prepared
        .filter((attachment) => !assignedDocumentIds.has(attachment.documentId))
        .map((attachment) => attachment.documentId),
    ),
  ];
  const buckets = SUCCESSIONIONLINE_EG_BUCKETS.map((bucket) => {
    const items = applicable.filter(
      (item) => item.officialAttachmentBucket === bucket.id && item.documentId,
    );
    const documentIds = [
      ...new Set(
        items.map((item) => item.documentId!).filter((documentId) => !ambiguous.has(documentId)),
      ),
    ];
    const files = prepared.filter((attachment) => documentIds.includes(attachment.documentId));
    return {
      ...bucket,
      checklistItemIds: items.map((item) => item.id),
      documentIds,
      preparedFileNames: files.map((attachment) => attachment.preparedName),
      preparedSha256: files.map((attachment) => attachment.sha256),
      count: files.length,
    };
  });
  return {
    buckets,
    ambiguousDocumentIds,
    unmappedChecklistItemIds,
    unassignedPreparedDocumentIds,
    ready:
      ambiguousDocumentIds.length === 0 &&
      unmappedChecklistItemIds.length === 0 &&
      unassignedPreparedDocumentIds.length === 0,
  };
}

export function assertOfficialEgDizAlignment(
  parsed: ParsedDiz,
  state: OfficialEgAttachmentState,
): void {
  if (!state.ready) throw new Error("DIZ_EG_ATTACHMENTS_NOT_QUALIFIED");
  qualifiedOfficialEgDizEvidence(parsed);
  const sourceHashesByRecordCode = new Map<string, string[]>();
  for (const attachment of parsed.attachments) {
    if (!attachment.recordCode) throw new Error("DIZ_EG_ATTACHMENTS_NOT_QUALIFIED");
    const bucket = state.buckets.find(
      (candidate) => candidate.recordCode === attachment.recordCode,
    );
    if (!bucket) throw new Error("DIZ_EG_ATTACHMENTS_NOT_QUALIFIED");
    const hashes = sourceHashesByRecordCode.get(attachment.recordCode) ?? [];
    hashes.push(attachment.sha256);
    sourceHashesByRecordCode.set(attachment.recordCode, hashes);
  }
  for (const bucket of state.buckets) {
    const sourceHashes = (sourceHashesByRecordCode.get(bucket.recordCode) ?? []).sort();
    const preparedHashes = [...bucket.preparedSha256].sort();
    if (
      sourceHashes.length !== preparedHashes.length ||
      sourceHashes.some((hash, index) => hash !== preparedHashes[index])
    )
      throw new Error("DIZ_EG_ATTACHMENTS_NOT_QUALIFIED");
  }
}
