import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getCanonicalField } from "../../domain/declaration.ts";
import { getDeclaration } from "./practices.ts";
import {
  ASSET_KIND_DETAILS,
  officialAssetValueField,
  wholeEurosToCents,
  type AssetCategory,
  type AssetKind,
  type SharedAsset,
} from "./domain-model.ts";
import {
  invalidateDerivedResultsIfPresent,
  parseRecord,
  recordAuditEvent,
} from "./domain-write-support.ts";

export function listSharedAssets(
  database: Database.Database,
  practiceId: string,
  declarationId?: string,
): SharedAsset[] {
  const declaration = declarationId
    ? getDeclaration(database, declarationId, practiceId)?.declaration
    : null;
  const rows = database
    .prepare(
      `SELECT shared_assets.id, shared_assets.practice_id, shared_assets.category,
              shared_assets.display_name, shared_assets.data_json, shared_assets.revision,
              shared_assets.updated_at
       FROM shared_assets
       WHERE shared_assets.practice_id = ?
         AND (
           ? IS NULL OR EXISTS (
             SELECT 1 FROM declaration_asset_entries
             WHERE declaration_asset_entries.declaration_id = ?
               AND declaration_asset_entries.asset_id = shared_assets.id
           )
         )
       ORDER BY shared_assets.category, shared_assets.display_name COLLATE NOCASE`,
    )
    .all(practiceId, declarationId ?? null, declarationId ?? null) as Array<
    Record<string, unknown>
  >;
  return rows.map((row) => {
    const data = parseRecord(String(row.data_json));
    const category = String(row.category) as AssetCategory;
    if (typeof data.kind !== "string" || !(data.kind in ASSET_KIND_DETAILS))
      throw new Error("ASSET_KIND_INVALID");
    const kind = data.kind as AssetKind;
    const details = ASSET_KIND_DETAILS[kind];
    if (category !== details.category) throw new Error("ASSET_CATEGORY_INCONSISTENT");
    const asset: SharedAsset = {
      id: String(row.id),
      practiceId: String(row.practice_id),
      category,
      kind,
      quadro: details.quadro,
      valueCents: String(data.valueCents ?? "0"),
      treatment: details.treatment,
      displayName: String(row.display_name),
      data,
      revision: Number(row.revision),
      updatedAt: String(row.updated_at),
    };
    const valueField = declaration ? officialAssetValueField(asset) : null;
    const canonicalValue = valueField
      ? getCanonicalField(declaration!, valueField.canonicalId, asset.id)?.value
      : null;
    const officialValueCents =
      canonicalValue === null || canonicalValue === undefined
        ? null
        : wholeEurosToCents(String(canonicalValue));
    return officialValueCents === null
      ? asset
      : { ...asset, valueCents: String(officialValueCents) };
  });
}

export function createSharedAsset(
  database: Database.Database,
  practiceId: string,
  input: {
    kind: AssetKind;
    displayName: string;
    valueCents?: bigint;
    declarationId?: string;
  },
): SharedAsset {
  const id = randomUUID();
  const now = new Date().toISOString();
  const kind = input.kind;
  const details = ASSET_KIND_DETAILS[kind];
  const data = { kind, valueCents: String(input.valueCents ?? 0n) };
  const declaration = database
    .prepare(
      `SELECT id FROM declarations
       WHERE practice_id = ? AND (? IS NULL OR id = ?)
       ORDER BY sequence DESC LIMIT 1`,
    )
    .get(practiceId, input.declarationId ?? null, input.declarationId ?? null) as
    | { id: string }
    | undefined;
  if (!declaration) throw new Error("DECLARATION_NOT_FOUND");
  database.transaction(() => {
    database
      .prepare(
        `INSERT INTO shared_assets(
           id, practice_id, category, display_name, data_json, revision, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(id, practiceId, details.category, input.displayName, JSON.stringify(data), now, now);
    database
      .prepare(
        `INSERT INTO declaration_asset_entries(declaration_id, asset_id, created_at)
         VALUES (?, ?, ?)`,
      )
      .run(declaration.id, id, now);
    database.prepare("UPDATE practices SET updated_at = ? WHERE id = ?").run(now, practiceId);
    invalidateDerivedResultsIfPresent(database, practiceId, declaration.id);
    recordAuditEvent(
      database,
      practiceId,
      null,
      "asset.created",
      "Aggiunto un bene o rapporto al procedimento.",
      { assetId: id, category: details.category, kind },
    );
  })();
  const asset = listSharedAssets(database, practiceId, declaration.id).find(
    (candidate) => candidate.id === id,
  );
  if (!asset) throw new Error("ASSET_CREATE_FAILED");
  return asset;
}
