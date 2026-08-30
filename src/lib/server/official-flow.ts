import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type Database from "better-sqlite3";
import {
  compareDizFields,
  opaqueDizEvidence,
  parseDiz,
  QUALIFIED_DIZ_FIELD_MAPPINGS,
  rewriteDizFields,
  type ThreeWayFieldComparison,
} from "../../domain/diz/index.ts";
import type { DizField, DizFieldLocator } from "../../domain/diz/xstream.ts";
import { getCanonicalField, setCanonicalField } from "../../domain/declaration.ts";
import { persistUpload, resolveBlobPath, type PersistedUpload } from "./blob-store.ts";
import { getDataDirectory } from "./config.ts";
import { buildComplianceReport } from "./domain-compliance.ts";
import { listOfficialAttachments } from "./official-attachments.ts";
import { getDeclaration, saveDeclaration } from "./practices.ts";

export const OFFICIAL_ARTIFACT_KINDS = [
  "telematic",
  "official-diagnostic",
  "print",
  "receipt-first",
  "receipt-second",
  "receipt-third",
  "payment-receipt",
  "cadastral-result",
  "other-official",
] as const;

export type UserOfficialArtifactKind = (typeof OFFICIAL_ARTIFACT_KINDS)[number];
type OfficialArtifactKind =
  | UserOfficialArtifactKind
  | "diz-imported"
  | "diz-exported"
  | "diz-reimported";

export interface OfficialArtifact {
  id: string;
  practiceId: string;
  declarationId: string;
  kind: OfficialArtifactKind;
  originalName: string;
  mediaType: string;
  byteSize: number;
  sha256: string;
  blobPath: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface DizRoundTrip {
  id: string;
  practiceId: string;
  declarationId: string;
  sourceArtifactId: string;
  exportArtifactId: string;
  reimportArtifactId: string | null;
  baseDeclarationRevision: number;
  comparison: OfficialDizComparison | null;
  status: "exported" | "conflicts" | "resolved";
  createdAt: string;
  resolvedAt: string | null;
}

type OfficialDizComparison = ThreeWayFieldComparison & {
  readonly opaqueEvidence?: {
    readonly changed: boolean;
    readonly base: unknown;
    readonly official: unknown;
  };
};

export type OfficialStage =
  | "draft"
  | "diz-imported"
  | "diz-exported"
  | "diz-reimported"
  | "telematic-generated"
  | "official-control-passed"
  | "transmitted"
  | "presented"
  | "cadastral-processing"
  | "closed";

export interface OfficialFlowSummary {
  stage: OfficialStage;
  stageLabel: string;
  artifacts: OfficialArtifact[];
  events: OfficialFlowEvent[];
  stageOverride: { stage: OfficialStage; reason: string; createdAt: string } | null;
  roundTrips: DizRoundTrip[];
  pendingRoundTrip: DizRoundTrip | null;
}

const OFFICIAL_STAGE_LABELS: Record<OfficialStage, string> = {
  draft: "Preparazione interna",
  "diz-imported": "DIZ di partenza acquisito",
  "diz-exported": "Esportata in DIZ",
  "diz-reimported": "DIZ reimportato e riconciliato",
  "telematic-generated": "Telematico generato",
  "official-control-passed": "Controllo ufficiale superato",
  transmitted: "Trasmessa; registrazione da verificare",
  presented: "Presentata e registrata",
  "cadastral-processing": "Presentata; esiti successivi acquisiti",
  closed: "Esiti finali acquisiti",
};

export interface OfficialFlowEvent {
  id: string;
  eventType: "presentation-confirmed";
  metadata: Record<string, unknown>;
  createdAt: string;
}

function mapArtifact(row: Record<string, unknown>): OfficialArtifact {
  return {
    id: String(row.id),
    practiceId: String(row.practice_id),
    declarationId: String(row.declaration_id),
    kind: String(row.kind) as OfficialArtifactKind,
    originalName: String(row.original_name),
    mediaType: String(row.media_type),
    byteSize: Number(row.byte_size),
    sha256: String(row.sha256),
    blobPath: String(row.blob_path),
    metadata: JSON.parse(String(row.metadata_json)) as Record<string, unknown>,
    createdAt: String(row.created_at),
  };
}

function mapRoundTrip(row: Record<string, unknown>): DizRoundTrip {
  return {
    id: String(row.id),
    practiceId: String(row.practice_id),
    declarationId: String(row.declaration_id),
    sourceArtifactId: String(row.source_artifact_id),
    exportArtifactId: String(row.export_artifact_id),
    reimportArtifactId: row.reimport_artifact_id ? String(row.reimport_artifact_id) : null,
    baseDeclarationRevision: Number(row.base_declaration_revision),
    comparison: row.comparison_json
      ? (JSON.parse(String(row.comparison_json)) as OfficialDizComparison)
      : null,
    status: String(row.status) as DizRoundTrip["status"],
    createdAt: String(row.created_at),
    resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
  };
}

function listArtifacts(
  database: Database.Database,
  practiceId: string,
  declarationId: string,
): OfficialArtifact[] {
  return (
    database
      .prepare(
        `SELECT * FROM official_artifacts
         WHERE practice_id = ? AND declaration_id = ?
         ORDER BY created_at DESC, id DESC`,
      )
      .all(practiceId, declarationId) as Array<Record<string, unknown>>
  ).map(mapArtifact);
}

function listRoundTrips(
  database: Database.Database,
  practiceId: string,
  declarationId: string,
): DizRoundTrip[] {
  return (
    database
      .prepare(
        `SELECT * FROM diz_round_trips
         WHERE practice_id = ? AND declaration_id = ?
         ORDER BY created_at DESC, id DESC`,
      )
      .all(practiceId, declarationId) as Array<Record<string, unknown>>
  ).map(mapRoundTrip);
}

function listEvents(
  database: Database.Database,
  practiceId: string,
  declarationId: string,
): OfficialFlowEvent[] {
  return (
    database
      .prepare(
        `SELECT id, event_type, metadata_json, created_at FROM official_flow_events
         WHERE practice_id = ? AND declaration_id = ?
         ORDER BY created_at DESC, id DESC`,
      )
      .all(practiceId, declarationId) as Array<{
      id: string;
      event_type: OfficialFlowEvent["eventType"];
      metadata_json: string;
      created_at: string;
    }>
  ).map((row) => ({
    id: row.id,
    eventType: row.event_type,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    createdAt: row.created_at,
  }));
}

function deriveStage(
  artifacts: OfficialArtifact[],
  roundTrips: DizRoundTrip[],
  events: OfficialFlowEvent[],
) {
  const has = (kind: OfficialArtifactKind) => artifacts.some((artifact) => artifact.kind === kind);
  const positiveSecondReceipt = artifacts.some(
    (artifact) => artifact.kind === "receipt-second" && artifact.metadata.outcome === "positive",
  );
  const manuallyConfirmed = events.some((event) => event.eventType === "presentation-confirmed");
  const officialControlPassed = artifacts.some(
    (artifact) => artifact.kind === "official-diagnostic" && artifact.metadata.outcome === "passed",
  );
  const cadastralResult = artifacts.find((artifact) => artifact.kind === "cadastral-result");
  if (positiveSecondReceipt || manuallyConfirmed)
    return {
      stage:
        cadastralResult?.metadata.outcome === "complete"
          ? ("closed" as const)
          : cadastralResult || has("receipt-third") || has("payment-receipt")
            ? ("cadastral-processing" as const)
            : ("presented" as const),
      stageLabel:
        cadastralResult?.metadata.outcome === "complete"
          ? "Esiti finali acquisiti"
          : cadastralResult || has("receipt-third") || has("payment-receipt")
            ? "Presentata; esiti successivi acquisiti"
            : "Presentata e registrata",
    };
  if (has("receipt-first"))
    return { stage: "transmitted" as const, stageLabel: "Trasmessa; registrazione da verificare" };
  if (officialControlPassed)
    return {
      stage: "official-control-passed" as const,
      stageLabel: "Controllo ufficiale superato",
    };
  if (has("telematic"))
    return { stage: "telematic-generated" as const, stageLabel: "Telematico generato" };
  if (roundTrips.some((roundTrip) => roundTrip.status === "resolved"))
    return { stage: "diz-reimported" as const, stageLabel: "DIZ reimportato e riconciliato" };
  if (has("diz-exported"))
    return { stage: "diz-exported" as const, stageLabel: "Esportata in DIZ" };
  if (has("diz-imported"))
    return { stage: "diz-imported" as const, stageLabel: "DIZ di partenza acquisito" };
  return { stage: "draft" as const, stageLabel: "Preparazione interna" };
}

export function getOfficialFlowSummary(
  database: Database.Database,
  practiceId: string,
  declarationId: string,
): OfficialFlowSummary {
  const artifacts = listArtifacts(database, practiceId, declarationId);
  const roundTrips = listRoundTrips(database, practiceId, declarationId);
  const events = listEvents(database, practiceId, declarationId);
  const derived = deriveStage(artifacts, roundTrips, events);
  const override = database
    .prepare(
      `SELECT stage, reason, created_at FROM official_stage_overrides
       WHERE practice_id = ? AND declaration_id = ?
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(practiceId, declarationId) as
    | { stage: OfficialStage; reason: string; created_at: string }
    | undefined;
  return {
    ...(override
      ? {
          stage: override.stage,
          stageLabel: `Stato corretto manualmente · ${OFFICIAL_STAGE_LABELS[override.stage]}`,
        }
      : derived),
    artifacts,
    events,
    stageOverride: override
      ? { stage: override.stage, reason: override.reason, createdAt: override.created_at }
      : null,
    roundTrips,
    pendingRoundTrip:
      roundTrips.find(
        (roundTrip) => roundTrip.status === "exported" || roundTrip.status === "conflicts",
      ) ?? null,
  };
}

function assertDeclaration(database: Database.Database, practiceId: string, declarationId: string) {
  const declaration = getDeclaration(database, declarationId, practiceId);
  if (!declaration) throw new Error("DECLARATION_NOT_FOUND");
  return declaration;
}

function createSnapshot(
  database: Database.Database,
  practiceId: string,
  declarationId: string,
  reason: "diz-import" | "diz-reimport" | "presentation" | "closure",
): void {
  const declaration = assertDeclaration(database, practiceId, declarationId);
  database
    .prepare(
      `INSERT INTO declaration_snapshots(
         id, practice_id, declaration_id, reason, declaration_revision, declaration_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      practiceId,
      declarationId,
      reason,
      declaration.revision,
      JSON.stringify(declaration.declaration),
      new Date().toISOString(),
    );
}

function ensureMilestoneSnapshots(
  database: Database.Database,
  practiceId: string,
  declarationId: string,
): void {
  const { stage } = deriveStage(
    listArtifacts(database, practiceId, declarationId),
    listRoundTrips(database, practiceId, declarationId),
    listEvents(database, practiceId, declarationId),
  );
  const hasSnapshot = (reason: "presentation" | "closure") =>
    Boolean(
      database
        .prepare(
          "SELECT 1 FROM declaration_snapshots WHERE declaration_id = ? AND reason = ? LIMIT 1",
        )
        .get(declarationId, reason),
    );
  if (
    ["presented", "cadastral-processing", "closed"].includes(stage) &&
    !hasSnapshot("presentation")
  )
    createSnapshot(database, practiceId, declarationId, "presentation");
  if (stage === "closed" && !hasSnapshot("closure"))
    createSnapshot(database, practiceId, declarationId, "closure");
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function recordAudit(
  database: Database.Database,
  practiceId: string,
  declarationId: string,
  eventType: string,
  summary: string,
  payload: Record<string, unknown>,
): void {
  database
    .prepare(
      `INSERT INTO domain_audit_events(
         id, practice_id, declaration_id, event_type, summary, payload_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      practiceId,
      declarationId,
      eventType,
      summary,
      JSON.stringify(payload),
      new Date().toISOString(),
    );
}

function insertArtifact(
  database: Database.Database,
  input: {
    practiceId: string;
    declarationId: string;
    kind: OfficialArtifactKind;
    metadata?: Record<string, unknown>;
    upload: PersistedUpload;
  },
): OfficialArtifact {
  assertDeclaration(database, input.practiceId, input.declarationId);
  const id = randomUUID();
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO official_artifacts(
         id, practice_id, declaration_id, kind, original_name, media_type,
         byte_size, sha256, blob_path, metadata_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      id,
      input.practiceId,
      input.declarationId,
      input.kind,
      input.upload.originalName,
      input.upload.mediaType,
      input.upload.byteSize,
      input.upload.sha256,
      input.upload.blobPath,
      JSON.stringify(input.metadata ?? {}),
      now,
    );
  const row = database.prepare("SELECT * FROM official_artifacts WHERE id = ?").get(id) as Record<
    string,
    unknown
  >;
  return mapArtifact(row);
}

function readArtifactBytes(
  artifact: OfficialArtifact,
  dataDirectory = getDataDirectory(),
): Promise<Buffer> {
  return readFile(resolveBlobPath(dataDirectory, artifact.blobPath));
}

export async function importDiz(
  database: Database.Database,
  input: { practiceId: string; declarationId: string; file: File; dataDirectory?: string },
): Promise<OfficialArtifact> {
  if (
    listRoundTrips(database, input.practiceId, input.declarationId).some(
      (roundTrip) => roundTrip.status === "exported" || roundTrip.status === "conflicts",
    )
  )
    throw new Error("DIZ_ROUND_TRIP_PENDING");
  const bytes = Buffer.from(await input.file.arrayBuffer());
  const parsed = parseDiz(bytes);
  const upload = await persistUpload(input.file, input.dataDirectory ?? getDataDirectory());
  let artifact!: OfficialArtifact;
  database.transaction(() => {
    createSnapshot(database, input.practiceId, input.declarationId, "diz-import");
    artifact = insertArtifact(database, {
      ...input,
      kind: "diz-imported",
      upload,
      metadata: {
        format: parsed.format,
        entries: parsed.entryCount,
        fields: parsed.fields.length,
        attachments: parsed.attachments.length,
        opaqueEvidence: opaqueDizEvidence(parsed),
      },
    });
    recordAudit(
      database,
      input.practiceId,
      input.declarationId,
      "diz.imported",
      "Acquisito un DIZ di partenza senza sovrascrivere dati della dichiarazione.",
      { artifactId: artifact.id, sha256: artifact.sha256 },
    );
  })();
  return artifact;
}

function latestDizSource(artifacts: OfficialArtifact[]): OfficialArtifact | null {
  return (
    artifacts.find(
      (artifact) => artifact.kind === "diz-reimported" || artifact.kind === "diz-imported",
    ) ?? null
  );
}

function singleSubjectEntryId(database: Database.Database, declarationId: string): string | null {
  const rows = database
    .prepare(
      `SELECT entry_id FROM declaration_subject_entries
       WHERE declaration_id = ? ORDER BY sequence`,
    )
    .all(declarationId) as Array<{ entry_id: string }>;
  return rows.length === 1 ? rows[0]!.entry_id : null;
}

function currentDizFields(
  database: Database.Database,
  practiceId: string,
  declarationId: string,
  baseFields: readonly DizField[],
): DizField[] {
  const declaration = assertDeclaration(database, practiceId, declarationId).declaration;
  const entryId = singleSubjectEntryId(database, declarationId);
  return baseFields.map((field) => {
    const mapping = QUALIFIED_DIZ_FIELD_MAPPINGS.find(
      (candidate) => candidate.dizCode === `${field.quadro}${field.field}`,
    );
    if (!mapping) return { ...field };
    if (!entryId) throw new Error("DIZ_MAPPING_CONTEXT_UNSUPPORTED");
    const matches = baseFields.filter(
      (candidate) => `${candidate.quadro}${candidate.field}` === mapping.dizCode,
    );
    if (matches.length !== 1) throw new Error("DIZ_MAPPING_CONTEXT_UNSUPPORTED");
    const current = getCanonicalField(declaration, mapping.catalogFieldId, entryId);
    return current ? { ...field, value: String(current.value ?? "") } : { ...field };
  });
}

export async function exportDiz(
  database: Database.Database,
  input: { practiceId: string; declarationId: string; dataDirectory?: string },
): Promise<{ artifact: OfficialArtifact; roundTrip: DizRoundTrip }> {
  const declaration = assertDeclaration(database, input.practiceId, input.declarationId);
  const compliance = buildComplianceReport(database, input.practiceId, input.declarationId);
  if (!compliance.ready) throw new Error("DIZ_COMPLIANCE_BLOCKED");
  const artifacts = listArtifacts(database, input.practiceId, input.declarationId);
  if (
    listRoundTrips(database, input.practiceId, input.declarationId).some(
      (roundTrip) => roundTrip.status === "exported" || roundTrip.status === "conflicts",
    )
  )
    throw new Error("DIZ_ROUND_TRIP_PENDING");
  const source = latestDizSource(artifacts);
  if (!source) throw new Error("DIZ_SOURCE_REQUIRED");
  const sourceBytes = await readArtifactBytes(source, input.dataDirectory);
  const parsed = parseDiz(sourceBytes);
  const currentFields = currentDizFields(
    database,
    input.practiceId,
    input.declarationId,
    parsed.fields,
  );
  const changes = currentFields
    .map((field, index) => ({ field, base: parsed.fields[index]! }))
    .filter(({ field, base }) => field.value !== base.value)
    .map(({ field, base }) => ({
      quadro: field.quadro,
      module: field.module,
      field: field.field,
      expectedValue: base.value,
      value: field.value,
    }));
  const preparedHashes = listOfficialAttachments(database, input.practiceId)
    .map((attachment) => attachment.sha256)
    .sort();
  const embeddedHashes = parsed.attachments.map((attachment) => attachment.sha256).sort();
  if (
    preparedHashes.length !== embeddedHashes.length ||
    preparedHashes.some((hash, index) => hash !== embeddedHashes[index])
  )
    throw new Error("DIZ_ATTACHMENTS_NOT_QUALIFIED");
  const bytes = rewriteDizFields(sourceBytes, changes, {
    qualifiedAttachments: embeddedHashes.map((sha256) => ({
      sha256,
      source: "official-control" as const,
    })),
  });
  const file = new File([new Uint8Array(bytes)], `dichiarazione-${declaration.sequence}.diz`, {
    type: "application/zip",
  });
  const upload = await persistUpload(file, input.dataDirectory ?? getDataDirectory());
  const id = randomUUID();
  const now = new Date().toISOString();
  let artifact!: OfficialArtifact;
  try {
    database.transaction(() => {
      artifact = insertArtifact(database, {
        practiceId: input.practiceId,
        declarationId: input.declarationId,
        kind: "diz-exported",
        upload,
        metadata: {
          sourceArtifactId: source.id,
          changes: changes.length,
          compliance: compliance.digest,
        },
      });
      database
        .prepare(
          `INSERT INTO diz_round_trips(
             id, practice_id, declaration_id, source_artifact_id, export_artifact_id,
             base_declaration_revision, base_fields_json, opaque_evidence_json,
             compliance_report_json, status, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'exported', ?)`,
        )
        .run(
          id,
          input.practiceId,
          input.declarationId,
          source.id,
          artifact.id,
          declaration.revision,
          JSON.stringify(parsed.fields),
          JSON.stringify(opaqueDizEvidence(parsed)),
          JSON.stringify(compliance),
          now,
        );
      recordAudit(
        database,
        input.practiceId,
        input.declarationId,
        "diz.exported",
        "Generato un DIZ da controllare in SuccessioniOnLine.",
        { artifactId: artifact.id, roundTripId: id, revision: declaration.revision },
      );
    })();
  } catch (error) {
    if ((error as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE")
      throw new Error("DIZ_ROUND_TRIP_PENDING");
    throw error;
  }
  return {
    artifact,
    roundTrip: listRoundTrips(database, input.practiceId, input.declarationId).find(
      (candidate) => candidate.id === id,
    )!,
  };
}

export async function reimportDiz(
  database: Database.Database,
  input: {
    practiceId: string;
    declarationId: string;
    roundTripId: string;
    file: File;
    dataDirectory?: string;
  },
): Promise<DizRoundTrip> {
  const roundTripRow = database
    .prepare(
      `SELECT * FROM diz_round_trips
       WHERE id = ? AND practice_id = ? AND declaration_id = ?`,
    )
    .get(input.roundTripId, input.practiceId, input.declarationId) as
    | Record<string, unknown>
    | undefined;
  if (!roundTripRow) throw new Error("DIZ_ROUND_TRIP_NOT_FOUND");
  const roundTrip = mapRoundTrip(roundTripRow);
  if (roundTrip.reimportArtifactId) throw new Error("DIZ_ALREADY_REIMPORTED");
  const official = parseDiz(Buffer.from(await input.file.arrayBuffer()));
  const baseFields = JSON.parse(String(roundTripRow.base_fields_json)) as DizField[];
  const currentFields = currentDizFields(
    database,
    input.practiceId,
    input.declarationId,
    baseFields,
  );
  const baseOpaqueEvidence = JSON.parse(String(roundTripRow.opaque_evidence_json)) as unknown;
  const officialOpaqueEvidence = opaqueDizEvidence(official);
  const comparison: OfficialDizComparison = {
    ...compareDizFields(baseFields, currentFields, official.fields),
    opaqueEvidence: {
      changed: JSON.stringify(baseOpaqueEvidence) !== JSON.stringify(officialOpaqueEvidence),
      base: baseOpaqueEvidence,
      official: officialOpaqueEvidence,
    },
  };
  const upload = await persistUpload(input.file, input.dataDirectory ?? getDataDirectory());
  const status = comparison.conflicts.length > 0 ? "conflicts" : "resolved";
  let artifact!: OfficialArtifact;
  database.transaction(() => {
    const currentRoundTrip = database
      .prepare("SELECT reimport_artifact_id FROM diz_round_trips WHERE id = ?")
      .get(roundTrip.id) as { reimport_artifact_id: string | null } | undefined;
    if (!currentRoundTrip) throw new Error("DIZ_ROUND_TRIP_NOT_FOUND");
    if (currentRoundTrip.reimport_artifact_id) throw new Error("DIZ_ALREADY_REIMPORTED");
    createSnapshot(database, input.practiceId, input.declarationId, "diz-reimport");
    artifact = insertArtifact(database, {
      practiceId: input.practiceId,
      declarationId: input.declarationId,
      kind: "diz-reimported",
      upload,
      metadata: {
        roundTripId: roundTrip.id,
        opaqueEvidence: officialOpaqueEvidence,
        conflicts: comparison.conflicts.length,
        opaqueChanges: comparison.opaque.length,
        opaqueEvidenceChanged: comparison.opaqueEvidence?.changed ?? false,
      },
    });
    if (status === "resolved") applyOfficialChanges(database, input, comparison, {});
    database
      .prepare(
        `UPDATE diz_round_trips
         SET reimport_artifact_id = ?, comparison_json = ?, status = ?, resolved_at = ?
         WHERE id = ?`,
      )
      .run(
        artifact.id,
        JSON.stringify(comparison),
        status,
        status === "resolved" ? new Date().toISOString() : null,
        roundTrip.id,
      );
    recordAudit(
      database,
      input.practiceId,
      input.declarationId,
      "diz.reimported",
      status === "resolved"
        ? "Reimportato e riconciliato il DIZ salvato da SuccessioniOnLine."
        : "Reimportato il DIZ; restano differenze da scegliere.",
      {
        artifactId: artifact.id,
        roundTripId: roundTrip.id,
        conflicts: comparison.conflicts.length,
        opaqueEvidenceChanged: comparison.opaqueEvidence?.changed ?? false,
      },
    );
  })();
  return listRoundTrips(database, input.practiceId, input.declarationId).find(
    (candidate) => candidate.id === roundTrip.id,
  )!;
}

function locatorKey(locator: DizFieldLocator): string {
  return `${locator.quadro}|${locator.module}|${locator.field}`;
}

function applyOfficialChanges(
  database: Database.Database,
  input: { practiceId: string; declarationId: string },
  comparison: ThreeWayFieldComparison,
  choices: Record<string, "current" | "official">,
): void {
  const record = assertDeclaration(database, input.practiceId, input.declarationId);
  const entryId = singleSubjectEntryId(database, input.declarationId);
  let declaration = record.declaration;
  let changed = false;
  const selected = [
    ...comparison.importFromOfficial,
    ...comparison.conflicts.filter((field) => choices[locatorKey(field)] === "official"),
  ];
  for (const field of selected) {
    const mapping = QUALIFIED_DIZ_FIELD_MAPPINGS.find(
      (candidate) => candidate.dizCode === `${field.quadro}${field.field}`,
    );
    if (!mapping) continue;
    if (!entryId) throw new Error("DIZ_MAPPING_CONTEXT_UNSUPPORTED");
    declaration = setCanonicalField(
      declaration,
      mapping.catalogFieldId,
      field.official ?? "",
      "manually_corrected",
      ["DIZ reimportato da SuccessioniOnLine"],
      entryId,
    );
    changed = true;
  }
  if (changed) saveDeclaration(database, input.declarationId, record.revision, declaration);
}

export function resolveDizConflicts(
  database: Database.Database,
  input: {
    practiceId: string;
    declarationId: string;
    roundTripId: string;
    choices: Record<string, "current" | "official">;
  },
): DizRoundTrip {
  const row = database
    .prepare(
      `SELECT * FROM diz_round_trips
       WHERE id = ? AND practice_id = ? AND declaration_id = ?`,
    )
    .get(input.roundTripId, input.practiceId, input.declarationId) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw new Error("DIZ_ROUND_TRIP_NOT_FOUND");
  const roundTrip = mapRoundTrip(row);
  if (roundTrip.status !== "conflicts" || !roundTrip.comparison)
    throw new Error("DIZ_CONFLICTS_NOT_PENDING");
  if (
    roundTrip.comparison.conflicts.some(
      (field) => !["current", "official"].includes(input.choices[locatorKey(field)] ?? ""),
    )
  )
    throw new Error("DIZ_CONFLICT_CHOICE_REQUIRED");
  const now = new Date().toISOString();
  database.transaction(() => {
    applyOfficialChanges(database, input, roundTrip.comparison!, input.choices);
    const result = database
      .prepare(
        "UPDATE diz_round_trips SET status = 'resolved', resolved_at = ? WHERE id = ? AND status = 'conflicts'",
      )
      .run(now, roundTrip.id);
    if (result.changes !== 1) throw new Error("DIZ_CONFLICTS_NOT_PENDING");
    recordAudit(
      database,
      input.practiceId,
      input.declarationId,
      "diz.conflicts_resolved",
      "Risolte le differenze del DIZ reimportato.",
      { roundTripId: roundTrip.id, choices: input.choices },
    );
  })();
  return listRoundTrips(database, input.practiceId, input.declarationId).find(
    (candidate) => candidate.id === roundTrip.id,
  )!;
}

export async function addOfficialArtifact(
  database: Database.Database,
  input: {
    practiceId: string;
    declarationId: string;
    kind: UserOfficialArtifactKind;
    file: File;
    metadata?: Record<string, unknown>;
    dataDirectory?: string;
  },
): Promise<OfficialArtifact> {
  if (!OFFICIAL_ARTIFACT_KINDS.includes(input.kind)) throw new Error("ARTIFACT_KIND_INVALID");
  if (
    input.kind === "official-diagnostic" &&
    !["passed", "failed"].includes(String(input.metadata?.outcome ?? ""))
  )
    throw new Error("OFFICIAL_DIAGNOSTIC_OUTCOME_REQUIRED");
  if (
    input.kind === "receipt-second" &&
    !["positive", "negative"].includes(String(input.metadata?.outcome ?? ""))
  )
    throw new Error("SECOND_RECEIPT_OUTCOME_REQUIRED");
  if (
    input.kind === "receipt-second" &&
    input.metadata?.outcome === "positive" &&
    (typeof input.metadata.registrationReference !== "string" ||
      input.metadata.registrationReference.trim().length === 0 ||
      input.metadata.registrationReference.trim().length > 160 ||
      !isIsoDate(input.metadata.registeredAt))
  )
    throw new Error("SECOND_RECEIPT_REGISTRATION_REQUIRED");
  if (
    input.kind === "cadastral-result" &&
    !["complete", "partial", "negative"].includes(String(input.metadata?.outcome ?? ""))
  )
    throw new Error("CADASTRAL_OUTCOME_REQUIRED");
  const upload = await persistUpload(input.file, input.dataDirectory ?? getDataDirectory());
  let artifact!: OfficialArtifact;
  database.transaction(() => {
    artifact = insertArtifact(database, { ...input, upload });
    recordAudit(
      database,
      input.practiceId,
      input.declarationId,
      `official.${input.kind}`,
      "Acquisito un artefatto del flusso ufficiale.",
      { artifactId: artifact.id, kind: input.kind, metadata: input.metadata ?? {} },
    );
    ensureMilestoneSnapshots(database, input.practiceId, input.declarationId);
  })();
  return artifact;
}

export function confirmPresentation(
  database: Database.Database,
  input: {
    practiceId: string;
    declarationId: string;
    reason: string;
    registrationReference: string;
    registeredAt: string;
  },
): OfficialFlowEvent {
  const reason = input.reason.trim();
  const registrationReference = input.registrationReference.trim();
  const registeredAt = input.registeredAt.trim();
  if (reason.length < 20 || reason.length > 2_000) throw new Error("PRESENTATION_REASON_INVALID");
  if (!registrationReference || registrationReference.length > 160 || !isIsoDate(registeredAt))
    throw new Error("PRESENTATION_REGISTRATION_REQUIRED");
  assertDeclaration(database, input.practiceId, input.declarationId);
  const metadata = { reason, registrationReference, registeredAt };
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  database.transaction(() => {
    const summary = getOfficialFlowSummary(database, input.practiceId, input.declarationId);
    if (
      summary.events.some((event) => event.eventType === "presentation-confirmed") ||
      summary.artifacts.some(
        (artifact) =>
          artifact.kind === "receipt-second" && artifact.metadata.outcome === "positive",
      )
    )
      throw new Error("PRESENTATION_ALREADY_CONFIRMED");
    database
      .prepare(
        `INSERT INTO official_flow_events(
           id, practice_id, declaration_id, event_type, metadata_json, created_at
         ) VALUES (?, ?, ?, 'presentation-confirmed', ?, ?)`,
      )
      .run(id, input.practiceId, input.declarationId, JSON.stringify(metadata), createdAt);
    recordAudit(
      database,
      input.practiceId,
      input.declarationId,
      "official.presentation_confirmed",
      "Confermata manualmente la presentazione perché la seconda ricevuta non è ottenibile.",
      metadata,
    );
    ensureMilestoneSnapshots(database, input.practiceId, input.declarationId);
  })();
  return { id, eventType: "presentation-confirmed", metadata, createdAt };
}

export function overrideOfficialStage(
  database: Database.Database,
  input: {
    practiceId: string;
    declarationId: string;
    stage: OfficialStage;
    reason: string;
  },
): void {
  const reason = input.reason.trim();
  if (!(input.stage in OFFICIAL_STAGE_LABELS)) throw new Error("OFFICIAL_STAGE_INVALID");
  if (reason.length < 10 || reason.length > 1_000) throw new Error("OFFICIAL_STAGE_REASON_INVALID");
  assertDeclaration(database, input.practiceId, input.declarationId);
  const artifacts = listArtifacts(database, input.practiceId, input.declarationId);
  const roundTrips = listRoundTrips(database, input.practiceId, input.declarationId);
  const events = listEvents(database, input.practiceId, input.declarationId);
  const derivedStage = deriveStage(artifacts, roundTrips, events).stage;
  const evidenceRanks: Partial<Record<OfficialStage, number>> = {
    presented: 1,
    "cadastral-processing": 2,
    closed: 3,
  };
  const derivedRank = evidenceRanks[derivedStage] ?? 0;
  const requestedRank = evidenceRanks[input.stage] ?? 0;
  if (requestedRank > derivedRank) throw new Error("OFFICIAL_STAGE_EVIDENCE_REQUIRED");
  database.transaction(() => {
    database
      .prepare(
        `INSERT INTO official_stage_overrides(
           id, practice_id, declaration_id, stage, reason, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        input.practiceId,
        input.declarationId,
        input.stage,
        reason,
        new Date().toISOString(),
      );
    recordAudit(
      database,
      input.practiceId,
      input.declarationId,
      "official.stage_overridden",
      `Corretto manualmente lo stato del flusso ufficiale in “${OFFICIAL_STAGE_LABELS[input.stage]}”.`,
      { stage: input.stage, reason, derivedStage },
    );
    ensureMilestoneSnapshots(database, input.practiceId, input.declarationId);
  })();
}

export function getOfficialArtifact(
  database: Database.Database,
  artifactId: string,
  practiceId: string,
): OfficialArtifact | null {
  const row = database
    .prepare("SELECT * FROM official_artifacts WHERE id = ? AND practice_id = ?")
    .get(artifactId, practiceId) as Record<string, unknown> | undefined;
  return row ? mapArtifact(row) : null;
}
