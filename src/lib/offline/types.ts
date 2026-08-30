export const OFFLINE_DATABASE_NAME = "sequent-offline";
export const OFFLINE_DATABASE_VERSION = 2;
export const OFFLINE_SCHEMA_VERSION = 2;

export interface OfflinePractice {
  id: string;
  title: string;
  declarationId: string;
  baseRevision: number;
  schemaVersion: number;
  status: "downloading" | "complete" | "partial" | "read-only";
  routeCount: number;
  documentCount: number;
  downloadedDocumentCount: number;
  selectedAt: string;
  updatedAt: string;
  failureReason: string | null;
  needsRefresh: boolean;
}

export interface OfflineDocument {
  key: string;
  practiceId: string;
  documentId: string;
  resourcePath: string;
  name: string;
  mediaType: string;
  byteSize: number;
  bytes?: ArrayBuffer;
  blob?: Blob;
}

export interface OfflineMutation {
  id: string;
  practiceId: string;
  declarationId: string;
  baseRevision: number;
  action: string;
  entries: Array<[string, string]>;
  createdAt: string;
}

export interface OfflineAttachment {
  id: string;
  practiceId: string;
  name: string;
  mediaType: string;
  byteSize: number;
  bytes: ArrayBuffer;
  createdAt: string;
}

export interface OfflineConflict {
  practiceId: string;
  baseRevision: number;
  detectedAt: string;
  reason: "server-changed" | "server-restored" | "sync-failed";
}
