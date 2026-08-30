import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { getCanonicalField } from "../../src/domain/declaration.ts";
import { parseDiz, qualifiedMappingFor } from "../../src/domain/diz/index.ts";
import { resolveBlobPath } from "../../src/lib/server/blob-store.ts";
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

function moduleSequence(module: string): number | null {
  if (!/^\d{1,8}$/.test(module)) return null;
  const sequence = Number.parseInt(module, 10);
  return Number.isSafeInteger(sequence) && sequence > 0 ? sequence : null;
}

const corpusDirectory = argument("--corpus");
const dataDirectory = argument("--data-dir") ?? process.env.SEQUENT_DATA_DIR;
const outputPath = argument("--output");
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
    qualifiedFields: number;
    attachments: number;
    readbackVerified: boolean;
  }> = [];
  const corpusHashes = new Set<string>();
  for (const [index, path] of files.entries()) {
    const parsed = parseDiz(await readFile(path));
    if (corpusHashes.has(parsed.sha256))
      throw new Error(`DIZ_CORPUS_QUALIFICATION_DUPLICATE:${index + 1}`);
    corpusHashes.add(parsed.sha256);
    const rows = database
      .prepare(
        `SELECT artifacts.*, declarations.declaration_json
         FROM official_artifacts AS artifacts
         JOIN declarations ON declarations.id = artifacts.declaration_id
         JOIN practices ON practices.id = artifacts.practice_id
         WHERE artifacts.kind = 'diz-imported' AND artifacts.sha256 = ?
           AND practices.status = 'active'`,
      )
      .all(parsed.sha256) as Array<Record<string, unknown>>;
    if (rows.length !== 1)
      throw new Error(`DIZ_CORPUS_QUALIFICATION_ARCHIVE_MATCH:${index + 1}:${rows.length}`);
    const row = rows[0]!;
    const readback = await readFile(resolveBlobPath(resolve(dataDirectory), String(row.blob_path)));
    if (createHash("sha256").update(readback).digest("hex") !== parsed.sha256) {
      throw new Error(`DIZ_CORPUS_QUALIFICATION_READBACK_HASH:${index + 1}`);
    }
    const reparsed = parseDiz(readback);
    if (reparsed.fields.length !== parsed.fields.length) {
      throw new Error(`DIZ_CORPUS_QUALIFICATION_READBACK_FIELDS:${index + 1}`);
    }
    const metadata = JSON.parse(String(row.metadata_json)) as {
      acquisition?: {
        qualifiedFields?: number;
        importedFields?: number;
        unchangedFields?: number;
        conflictingFields?: number;
        missingTargets?: number;
      };
    };
    const acquisition = metadata.acquisition;
    if (
      !acquisition ||
      acquisition.conflictingFields !== 0 ||
      acquisition.missingTargets !== 0 ||
      (acquisition.importedFields ?? 0) + (acquisition.unchangedFields ?? 0) !==
        acquisition.qualifiedFields
    ) {
      throw new Error(`DIZ_CORPUS_QUALIFICATION_ACQUISITION_INCOMPLETE:${index + 1}`);
    }
    const declarationId = String(row.declaration_id);
    const practiceId = String(row.practice_id);
    const declaration = getDeclaration(database, declarationId, practiceId)?.declaration;
    if (!declaration) throw new Error(`DIZ_CORPUS_QUALIFICATION_DECLARATION_MISSING:${index + 1}`);
    const entries = database
      .prepare(
        `SELECT entry_id, sequence FROM declaration_subject_entries
         WHERE declaration_id = ? ORDER BY sequence`,
      )
      .all(declarationId) as Array<{ entry_id: string; sequence: number }>;
    const qualifiedFields = parsed.fields.filter(
      (field) => field.value.length > 0 && qualifiedMappingFor(field),
    );
    for (const field of qualifiedFields) {
      const mapping = qualifiedMappingFor(field)!;
      const sequence = field.quadro === "EA" ? moduleSequence(field.module) : null;
      const entityId = entries.find((entry) => entry.sequence === sequence)?.entry_id ?? null;
      if (
        !entityId ||
        String(getCanonicalField(declaration, mapping.catalogFieldId, entityId)?.value ?? "") !==
          field.value
      ) {
        throw new Error(`DIZ_CORPUS_QUALIFICATION_CANONICAL_READBACK:${index + 1}`);
      }
    }
    samples.push({
      sample: index + 1,
      fields: parsed.fields.length,
      qualifiedFields: qualifiedFields.length,
      attachments: parsed.attachments.length,
      readbackVerified: true,
    });
  }

  const report = {
    format: "sequent-diz-corpus-qualification",
    version: 1,
    generatedAt: new Date().toISOString(),
    commit: process.env.SEQUENT_COMMIT_SHA ?? "working-tree",
    corpusFiles: files.length,
    uniqueFiles: corpusHashes.size,
    samples,
    passed: true,
  };
  if (outputPath) {
    await writeFile(resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
} finally {
  database.close();
}
