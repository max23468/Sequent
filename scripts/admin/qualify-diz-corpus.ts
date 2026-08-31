import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { getCanonicalField } from "../../src/domain/declaration.ts";
import {
  dizMappingIdentity,
  dizMappingOccurrenceId,
  importMappingFor,
  opaqueDizEvidence,
  parseDiz,
} from "../../src/domain/diz/index.ts";
import { resolveBlobPath } from "../../src/lib/server/blob-store.ts";
import { canonicalSubjectIdentity } from "../../src/lib/server/domain-subjects.ts";
import { getDeclaration } from "../../src/lib/server/practices.ts";

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

async function listDizFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listDizFiles(path)));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".diz")) files.push(path);
  }
  return files.sort();
}

async function writePrivateReport(path: string, report: unknown): Promise<void> {
  const resolved = resolve(path);
  await mkdir(dirname(resolved), { recursive: true, mode: 0o700 });
  await writeFile(resolved, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await chmod(resolved, 0o600);
}

const corpusDirectory = argument("--corpus");
const dataDirectory = argument("--data-dir") ?? process.env.SEQUENT_DATA_DIR;
const outputPath = argument("--output");
const releaseCommit = process.env.SEQUENT_COMMIT_SHA;
if (!releaseCommit || !/^[a-f0-9]{40}$/.test(releaseCommit))
  throw new Error("DIZ_CORPUS_QUALIFICATION_RELEASE_REQUIRED");
if (!corpusDirectory) throw new Error("Usa --corpus <directory-privata>.");
if (!dataDirectory) throw new Error("Usa --data-dir <directory-dati>.");

const files = await listDizFiles(resolve(corpusDirectory));
if (files.length !== 5) throw new Error(`DIZ_CORPUS_QUALIFICATION_COUNT:${files.length}`);
const database = new Database(resolve(dataDirectory, "sequent.sqlite"), {
  readonly: true,
  fileMustExist: true,
});

try {
  const samples: Array<{
    sample: number;
    fields: number;
    mappedFields: number;
    preservedFields: number;
    attachments: number;
    materializedAttachments: number;
    archiveArtifacts: number;
    readbackVerified: boolean;
  }> = [];
  const corpusHashes = new Set<string>();
  for (const [index, path] of files.entries()) {
    const parsed = parseDiz(await readFile(path));
    if (corpusHashes.has(parsed.sha256))
      throw new Error(`DIZ_CORPUS_QUALIFICATION_DUPLICATE:${index + 1}`);
    corpusHashes.add(parsed.sha256);
    const mappedFields = parsed.fields.filter(
      (field) => field.value.length > 0 && importMappingFor(field),
    );
    const expectedOpaqueEvidence = opaqueDizEvidence(parsed);
    const rows = database
      .prepare(
        `SELECT artifacts.*
         FROM official_artifacts AS artifacts
         JOIN declarations ON declarations.id = artifacts.declaration_id
         JOIN practices ON practices.id = artifacts.practice_id
         WHERE artifacts.kind = 'diz-imported' AND artifacts.sha256 = ?
           AND practices.status = 'active'
         ORDER BY artifacts.created_at DESC, artifacts.id DESC`,
      )
      .all(parsed.sha256) as Array<Record<string, unknown>>;
    if (rows.length === 0) throw new Error(`DIZ_CORPUS_QUALIFICATION_ARCHIVE_MATCH:${index + 1}:0`);
    const selected = rows
      .map((row) => {
        try {
          const metadata = JSON.parse(String(row.metadata_json)) as {
            format?: unknown;
            fields?: unknown;
            attachments?: unknown;
            opaqueEvidence?: unknown;
            acquisition?: {
              version?: unknown;
              sourceFields?: unknown;
              nonEmptyFields?: unknown;
              mappedFields?: unknown;
              importedFields?: unknown;
              unchangedFields?: unknown;
              conflictingFields?: unknown;
              missingTargets?: unknown;
              converterOnlyFields?: unknown;
              opaqueFields?: unknown;
              preservedFields?: unknown;
              synchronizedSubjectEntries?: unknown;
              synchronizedSharedSubjects?: unknown;
              subjectIdentityConflicts?: unknown;
              targetBindings?: unknown;
            };
          };
          const acquisition = metadata.acquisition;
          const counts = acquisition
            ? [
                acquisition.sourceFields,
                acquisition.nonEmptyFields,
                acquisition.mappedFields,
                acquisition.importedFields,
                acquisition.unchangedFields,
                acquisition.conflictingFields,
                acquisition.missingTargets,
                acquisition.converterOnlyFields,
                acquisition.opaqueFields,
                acquisition.preservedFields,
                acquisition.synchronizedSubjectEntries,
                acquisition.synchronizedSharedSubjects,
                acquisition.subjectIdentityConflicts,
              ]
            : [];
          if (
            !acquisition ||
            acquisition.version !== 3 ||
            counts.some((count) => !Number.isInteger(count) || Number(count) < 0) ||
            metadata.format !== parsed.format ||
            metadata.fields !== parsed.fields.length ||
            metadata.attachments !== parsed.attachments.length ||
            JSON.stringify(metadata.opaqueEvidence) !== JSON.stringify(expectedOpaqueEvidence) ||
            acquisition.sourceFields !== parsed.fields.length ||
            acquisition.nonEmptyFields !==
              parsed.fields.filter((field) => field.value.length > 0).length ||
            acquisition.mappedFields !== mappedFields.length ||
            Number(acquisition.importedFields) + Number(acquisition.unchangedFields) !==
              mappedFields.length ||
            acquisition.conflictingFields !== 0 ||
            acquisition.missingTargets !== 0 ||
            acquisition.subjectIdentityConflicts !== 0 ||
            acquisition.preservedFields !==
              Number(acquisition.converterOnlyFields) + Number(acquisition.opaqueFields) ||
            !acquisition.targetBindings ||
            typeof acquisition.targetBindings !== "object"
          )
            return null;
          return row;
        } catch {
          return null;
        }
      })
      .find((row) => row !== null);
    if (!selected) throw new Error(`DIZ_CORPUS_QUALIFICATION_ACQUISITION_INCOMPLETE:${index + 1}`);
    const row = selected;
    const readback = await readFile(resolveBlobPath(resolve(dataDirectory), String(row.blob_path)));
    if (createHash("sha256").update(readback).digest("hex") !== parsed.sha256) {
      throw new Error(`DIZ_CORPUS_QUALIFICATION_READBACK_HASH:${index + 1}`);
    }
    const reparsed = parseDiz(readback);
    if (reparsed.fields.length !== parsed.fields.length) {
      throw new Error(`DIZ_CORPUS_QUALIFICATION_READBACK_FIELDS:${index + 1}`);
    }
    const declarationId = String(row.declaration_id);
    const practiceId = String(row.practice_id);
    const materializedAttachmentHashes = new Set(
      (
        database
          .prepare("SELECT sha256 FROM documents WHERE practice_id = ?")
          .all(practiceId) as Array<{ sha256: string }>
      ).map((document) => document.sha256),
    );
    if (
      parsed.attachments.some((attachment) => !materializedAttachmentHashes.has(attachment.sha256))
    ) {
      throw new Error(`DIZ_CORPUS_QUALIFICATION_ATTACHMENTS_NOT_MATERIALIZED:${index + 1}`);
    }
    const declaration = getDeclaration(database, declarationId, practiceId)?.declaration;
    if (!declaration) throw new Error(`DIZ_CORPUS_QUALIFICATION_DECLARATION_MISSING:${index + 1}`);
    const acquisition = JSON.parse(String(row.metadata_json)).acquisition as {
      preservedFields: number;
      targetBindings: Record<string, string>;
    };
    for (const field of mappedFields) {
      const mapping = importMappingFor(field)!;
      const identity = dizMappingIdentity(field, mapping);
      const entityId = ["subject", "asset", "decedent"].includes(mapping.entityScope)
        ? (acquisition.targetBindings[identity] ?? null)
        : null;
      const occurrenceId = dizMappingOccurrenceId(field, mapping);
      if (
        (["subject", "asset", "decedent"].includes(mapping.entityScope) && !entityId) ||
        String(
          getCanonicalField(declaration, mapping.catalogFieldId, entityId, occurrenceId)?.value ??
            "",
        ) !== field.value
      ) {
        throw new Error(`DIZ_CORPUS_QUALIFICATION_CANONICAL_READBACK:${index + 1}`);
      }
    }
    const subjectTargetIds = new Set(
      mappedFields
        .filter((field) => importMappingFor(field)?.entityScope === "subject")
        .map((field) => {
          const mapping = importMappingFor(field)!;
          return acquisition.targetBindings[dizMappingIdentity(field, mapping)] ?? null;
        })
        .filter((targetId): targetId is string => Boolean(targetId)),
    );
    for (const entryId of subjectTargetIds) {
      const identity = canonicalSubjectIdentity(declaration, entryId);
      const stored = database
        .prepare(
          `SELECT entries.display_name_snapshot, entries.tax_code_snapshot,
                  subjects.display_name, subjects.tax_code
           FROM declaration_subject_entries AS entries
           JOIN shared_subjects AS subjects ON subjects.id = entries.subject_id
           WHERE entries.declaration_id = ? AND entries.entry_id = ?
             AND subjects.practice_id = ?`,
        )
        .get(declarationId, entryId, practiceId) as
        | {
            display_name_snapshot: string | null;
            tax_code_snapshot: string | null;
            display_name: string;
            tax_code: string | null;
          }
        | undefined;
      if (
        !stored ||
        (identity.displayName !== null &&
          (stored.display_name_snapshot !== identity.displayName ||
            stored.display_name !== identity.displayName)) ||
        (identity.hasTaxCode &&
          (stored.tax_code_snapshot !== identity.taxCode || stored.tax_code !== identity.taxCode))
      ) {
        throw new Error(`DIZ_CORPUS_QUALIFICATION_SUBJECT_IDENTITY:${index + 1}`);
      }
    }
    samples.push({
      sample: index + 1,
      fields: parsed.fields.length,
      mappedFields: mappedFields.length,
      preservedFields: acquisition.preservedFields,
      attachments: parsed.attachments.length,
      materializedAttachments: parsed.attachments.length,
      archiveArtifacts: rows.length,
      readbackVerified: true,
    });
  }

  const report = {
    format: "sequent-diz-corpus-qualification",
    version: 2,
    generatedAt: new Date().toISOString(),
    commit: releaseCommit,
    corpusFiles: files.length,
    uniqueFiles: corpusHashes.size,
    samples,
    passed: true,
  };
  if (outputPath) {
    await writePrivateReport(outputPath, report);
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
} finally {
  database.close();
}
