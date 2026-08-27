import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  calculateSuccessionTax,
  SUCCESSION_TAX_RULESET_VERSION,
  type BeneficiaryTaxResult,
  type SuccessionAllocation,
} from "../../domain/calculation.ts";
import {
  createEmptyDeclaration,
  getCanonicalField,
  parseDeclaration,
  setCanonicalField,
  type DeclarationSnapshot,
} from "../../domain/declaration.ts";
import {
  validateDevolutionScenario,
  type DevolutionIssue,
  type DevolutionShare,
} from "../../domain/devolution.ts";
import {
  getCatalogField,
  getCatalogStatus,
  listQuadroFields,
  listTechnicalEnumerationValues,
  type QuadroId,
} from "../../domain/official-catalog/catalog.ts";
import {
  validateDeclaration,
  validateFieldValue,
  validateRepeatedEaSubjects,
  type ValidationIssue,
} from "../../domain/validation.ts";
import { getDeclaration, saveDeclaration } from "./practices.ts";

export type SubjectRole = "decedent" | "beneficiary" | "representative" | "other";
export type AssetCategory = "property" | "financial" | "other_asset" | "liability" | "donation";
export type AssetKind =
  | "land"
  | "building"
  | "tavolare_land"
  | "tavolare_building"
  | "company"
  | "securities"
  | "aircraft"
  | "vessel"
  | "money"
  | "inventory"
  | "other"
  | "liability"
  | "donation";

const ASSET_KIND_DETAILS: Record<
  AssetKind,
  { category: AssetCategory; quadro: QuadroId | null; treatment: SuccessionAllocation["treatment"] }
> = {
  land: { category: "property", quadro: "EB", treatment: "estate" },
  building: { category: "property", quadro: "EC", treatment: "estate" },
  tavolare_land: { category: "property", quadro: "EL", treatment: "estate" },
  tavolare_building: { category: "property", quadro: "EM", treatment: "estate" },
  company: { category: "other_asset", quadro: "EN", treatment: "estate" },
  securities: { category: "financial", quadro: "EO", treatment: "estate" },
  aircraft: { category: "other_asset", quadro: "EP", treatment: "estate" },
  vessel: { category: "other_asset", quadro: "EQ", treatment: "estate" },
  money: { category: "financial", quadro: "ER", treatment: "dn" },
  inventory: { category: "other_asset", quadro: "ER", treatment: "bi" },
  other: { category: "other_asset", quadro: "ER", treatment: "estate" },
  liability: { category: "liability", quadro: "ED", treatment: "liability" },
  donation: { category: "donation", quadro: null, treatment: "estate" },
};

function assetCatalogField(asset: SharedAsset, name: string) {
  return asset.quadro
    ? (listQuadroFields(asset.quadro).find((field) => field.name === name) ?? null)
    : null;
}

function officialAssetValueField(asset: SharedAsset) {
  return asset.quadro
    ? (listQuadroFields(asset.quadro).find(
        (field) =>
          field.name === "Valore" &&
          !field.path.includes("/Devoluzione") &&
          !field.path.includes("/Ripartizione"),
      ) ?? null)
    : null;
}

function wholeEurosToCents(value: string): bigint | null {
  return /^\d+$/u.test(value) ? BigInt(value) * 100n : value === "" ? 0n : null;
}

function hasAmbiguousTaxPositions(
  declaration: DeclarationSnapshot,
  entries: DeclarationSubjectEntry[],
): boolean {
  if (entries.length < 2) return false;
  const relevantFields = [
    "quadro-ea.soggetto.tipo",
    "quadro-ea.soggetto.grado-parentela",
    "quadro-ea.soggetto.disabilita",
  ];
  const signatures = new Set(
    entries.map((entry) =>
      relevantFields
        .map((fieldId) => String(getCanonicalField(declaration, fieldId, entry.id)?.value ?? ""))
        .join("\u0000"),
    ),
  );
  return signatures.size > 1;
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function allocateConservedCents(
  total: bigint,
  shares: Array<{ numerator: bigint; denominator: bigint; index: number }>,
): Map<number, bigint> | null {
  if (
    total < 0n ||
    shares.length === 0 ||
    shares.some(
      (share) =>
        share.numerator <= 0n || share.denominator <= 0n || share.numerator > share.denominator,
    )
  )
    return null;
  let commonDenominator = 1n;
  for (const share of shares)
    commonDenominator =
      (commonDenominator * share.denominator) /
      greatestCommonDivisor(commonDenominator, share.denominator);
  const numeratorTotal = shares.reduce(
    (sum, share) => sum + share.numerator * (commonDenominator / share.denominator),
    0n,
  );
  if (numeratorTotal !== commonDenominator) return null;
  const allocations = shares.map((share) => ({
    ...share,
    value: (total * share.numerator) / share.denominator,
    remainder: (total * share.numerator) % share.denominator,
  }));
  let centsToAssign = total - allocations.reduce((sum, share) => sum + share.value, 0n);
  allocations.sort((left, right) => {
    const leftScaled = left.remainder * right.denominator;
    const rightScaled = right.remainder * left.denominator;
    return leftScaled === rightScaled
      ? left.index - right.index
      : leftScaled > rightScaled
        ? -1
        : 1;
  });
  for (const allocation of allocations) {
    if (centsToAssign <= 0n) break;
    allocation.value += 1n;
    centsToAssign -= 1n;
  }
  return new Map(allocations.map((allocation) => [allocation.index, allocation.value]));
}

export interface SharedSubject {
  id: string;
  practiceId: string;
  role: SubjectRole;
  displayName: string;
  taxCode: string | null;
  data: Record<string, unknown>;
  revision: number;
  updatedAt: string;
}

export interface DeclarationSubjectEntry {
  id: string;
  subjectId: string;
  declarationId: string;
  sequence: number;
  occurrence: number;
  role: SubjectRole;
  displayName: string;
  taxCode: string | null;
}

export interface SharedAsset {
  id: string;
  practiceId: string;
  category: AssetCategory;
  kind: AssetKind;
  quadro: QuadroId | null;
  valueCents: string;
  treatment: SuccessionAllocation["treatment"];
  displayName: string;
  data: Record<string, unknown>;
  revision: number;
  updatedAt: string;
}

export interface DevolutionScenario {
  id: string;
  status: "draft" | "blocked" | "confirmed" | "superseded";
  shares: Array<
    DevolutionShare & {
      reliefCode: string;
      reductionYears: 0 | 1 | 2 | 3 | 4 | 5;
      previousSuccessionValueCents: bigint;
      foreignTaxCents: bigint;
    }
  >;
  issues: DevolutionIssue[];
  updatedAt: string;
}

export interface CalculationRun {
  id: string;
  status: "draft" | "blocked" | "confirmed" | "superseded";
  beneficiaries: BeneficiaryTaxResult[];
  totalTaxCents: bigint;
  issues: ValidationIssue[];
  updatedAt: string;
}

export interface ChecklistItem {
  id: string;
  requirementKind: "attachment" | "source" | "retain" | "subsequent_proof";
  importance: "blocking" | "conditional" | "recommended";
  label: string;
  status: "missing" | "available" | "not_applicable" | "overridden";
  sourceRefs: string[];
  documentId: string | null;
  decisionNote: string | null;
}

export interface DomainAuditEvent {
  id: string;
  eventType: string;
  summary: string;
  createdAt: string;
}

export interface PracticeDomainSummary {
  practiceId: string;
  subjectCount: number;
  assetCount: number;
  declarationCount: number;
  label: "Da impostare" | "Da completare" | "In controllo";
  nextStep: string;
}

function parseRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function officialDateToIso(value: string): string | null {
  const match = /^(\d{2})(\d{2})(\d{4})$/.exec(value);
  if (!match) return null;
  const [, day, month, year] = match;
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== iso ? null : iso;
}

function recordAuditEvent(
  database: Database.Database,
  practiceId: string,
  declarationId: string | null,
  eventType: string,
  summary: string,
  payload: unknown,
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

function supersedeDerivedResults(
  database: Database.Database,
  practiceId: string,
  declarationId: string,
  now: string,
): void {
  database
    .prepare(
      `UPDATE devolution_scenarios
       SET status = 'superseded', updated_at = ?
       WHERE practice_id = ? AND declaration_id = ? AND status <> 'superseded'`,
    )
    .run(now, practiceId, declarationId);
  database
    .prepare(
      `UPDATE calculation_runs
       SET status = 'superseded', updated_at = ?
       WHERE practice_id = ? AND declaration_id = ? AND status <> 'superseded'`,
    )
    .run(now, practiceId, declarationId);
}

function invalidateDerivedResultsIfPresent(
  database: Database.Database,
  practiceId: string,
  declarationId: string,
): number | null {
  const record = getDeclaration(database, declarationId, practiceId);
  if (!record) throw new Error("DECLARATION_NOT_FOUND");
  const hasResults = Boolean(
    record.declaration.confirmedDevolutionScenarioId ||
    record.declaration.latestCalculationRunId ||
    database
      .prepare(
        `SELECT 1 FROM devolution_scenarios
         WHERE practice_id = ? AND declaration_id = ? AND status <> 'superseded'
         UNION ALL
         SELECT 1 FROM calculation_runs
         WHERE practice_id = ? AND declaration_id = ? AND status <> 'superseded'
         LIMIT 1`,
      )
      .get(practiceId, declarationId, practiceId, declarationId),
  );
  if (!hasResults) return null;
  const now = new Date().toISOString();
  supersedeDerivedResults(database, practiceId, declarationId, now);
  const revision = saveDeclaration(database, declarationId, record.revision, {
    ...record.declaration,
    confirmedDevolutionScenarioId: null,
    latestCalculationRunId: null,
  });
  recordAuditEvent(
    database,
    practiceId,
    declarationId,
    "derived-results.superseded",
    "Ripartizione e calcoli precedenti devono essere riesaminati dopo la modifica dei dati.",
    { revision },
  );
  return revision;
}

export function listSharedSubjects(
  database: Database.Database,
  practiceId: string,
): SharedSubject[] {
  const rows = database
    .prepare(
      `SELECT id, practice_id, role, display_name, tax_code, data_json, revision, updated_at
       FROM shared_subjects WHERE practice_id = ?
       ORDER BY CASE role WHEN 'decedent' THEN 0 WHEN 'beneficiary' THEN 1 ELSE 2 END,
                display_name COLLATE NOCASE`,
    )
    .all(practiceId) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    practiceId: String(row.practice_id),
    role: String(row.role) as SubjectRole,
    displayName: String(row.display_name),
    taxCode: row.tax_code === null ? null : String(row.tax_code),
    data: parseRecord(String(row.data_json)),
    revision: Number(row.revision),
    updatedAt: String(row.updated_at),
  }));
}

export function createSharedSubject(
  database: Database.Database,
  practiceId: string,
  input: {
    role: SubjectRole;
    displayName: string;
    taxCode?: string | null;
    declarationId?: string;
  },
): SharedSubject {
  const id = randomUUID();
  const now = new Date().toISOString();
  database.transaction(() => {
    if (
      input.role === "decedent" &&
      database
        .prepare("SELECT 1 FROM shared_subjects WHERE practice_id = ? AND role = 'decedent'")
        .get(practiceId)
    ) {
      throw new Error("DECEDENT_ALREADY_EXISTS");
    }
    database
      .prepare(
        `INSERT INTO shared_subjects(
           id, practice_id, role, display_name, tax_code, data_json, revision, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, '{}', 1, ?, ?)`,
      )
      .run(id, practiceId, input.role, input.displayName, input.taxCode || null, now, now);
    if (input.role !== "decedent") {
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
      const sequence = (
        database
          .prepare(
            `SELECT coalesce(max(sequence), 0) + 1 AS sequence
             FROM declaration_subject_entries WHERE declaration_id = ?`,
          )
          .get(declaration.id) as { sequence: number }
      ).sequence;
      database
        .prepare(
          `INSERT INTO declaration_subject_entries(
             declaration_id, entry_id, subject_id, sequence, created_at
           ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(declaration.id, id, id, sequence, now);
    }
    database.prepare("UPDATE practices SET updated_at = ? WHERE id = ?").run(now, practiceId);
    if (input.declarationId)
      invalidateDerivedResultsIfPresent(database, practiceId, input.declarationId);
    recordAuditEvent(
      database,
      practiceId,
      null,
      "subject.created",
      "Aggiunto un soggetto al procedimento.",
      { subjectId: id, role: input.role },
    );
  })();
  const subject = listSharedSubjects(database, practiceId).find((candidate) => candidate.id === id);
  if (!subject) throw new Error("SUBJECT_CREATE_FAILED");
  return subject;
}

export function listDeclarationSubjectEntries(
  database: Database.Database,
  practiceId: string,
  declarationId: string,
): DeclarationSubjectEntry[] {
  const rows = database
    .prepare(
      `SELECT declaration_subject_entries.entry_id,
              declaration_subject_entries.subject_id,
              declaration_subject_entries.declaration_id,
              declaration_subject_entries.sequence,
              shared_subjects.role,
              shared_subjects.display_name,
              shared_subjects.tax_code
       FROM declaration_subject_entries
       JOIN declarations ON declarations.id = declaration_subject_entries.declaration_id
       JOIN shared_subjects ON shared_subjects.id = declaration_subject_entries.subject_id
       WHERE declaration_subject_entries.declaration_id = ?
         AND declarations.practice_id = ?
         AND shared_subjects.practice_id = ?
       ORDER BY declaration_subject_entries.sequence`,
    )
    .all(declarationId, practiceId, practiceId) as Array<Record<string, unknown>>;
  const occurrences = new Map<string, number>();
  return rows.map((row) => {
    const subjectId = String(row.subject_id);
    const occurrence = (occurrences.get(subjectId) ?? 0) + 1;
    occurrences.set(subjectId, occurrence);
    return {
      id: String(row.entry_id),
      subjectId,
      declarationId: String(row.declaration_id),
      sequence: Number(row.sequence),
      occurrence,
      role: String(row.role) as SubjectRole,
      displayName: String(row.display_name),
      taxCode: row.tax_code === null ? null : String(row.tax_code),
    };
  });
}

export function createDeclarationSubjectEntry(
  database: Database.Database,
  input: {
    practiceId: string;
    declarationId: string;
    sourceEntryId: string;
    expectedRevision: number;
  },
): { entry: DeclarationSubjectEntry; revision: number } {
  const record = getDeclaration(database, input.declarationId, input.practiceId);
  if (!record) throw new Error("DECLARATION_NOT_FOUND");
  const source = listDeclarationSubjectEntries(
    database,
    input.practiceId,
    input.declarationId,
  ).find((entry) => entry.id === input.sourceEntryId);
  if (!source) throw new Error("SUBJECT_ENTRY_NOT_FOUND");
  const id = randomUUID();
  const now = new Date().toISOString();
  const sequence = (
    database
      .prepare(
        `SELECT coalesce(max(sequence), 0) + 1 AS sequence
         FROM declaration_subject_entries WHERE declaration_id = ?`,
      )
      .get(input.declarationId) as { sequence: number }
  ).sequence;
  let declaration = record.declaration;
  for (const field of Object.values(record.declaration.fields)) {
    if (field.entityId !== source.id) continue;
    declaration = setCanonicalField(
      declaration,
      field.fieldId,
      structuredClone(field.value),
      field.state,
      field.sourceRefs,
      id,
    );
  }
  declaration = {
    ...declaration,
    confirmedDevolutionScenarioId: null,
    latestCalculationRunId: null,
  };
  const revision = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO declaration_subject_entries(
           declaration_id, entry_id, subject_id, sequence, created_at
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(input.declarationId, id, source.subjectId, sequence, now);
    supersedeDerivedResults(database, input.practiceId, input.declarationId, now);
    const nextRevision = saveDeclaration(
      database,
      input.declarationId,
      input.expectedRevision,
      declaration,
    );
    recordAuditEvent(
      database,
      input.practiceId,
      input.declarationId,
      "subject.entry_created",
      "Aggiunta un’altra posizione dello stesso soggetto nel Quadro EA.",
      { entryId: id, sourceEntryId: source.id, subjectId: source.subjectId },
    );
    return nextRevision;
  })();
  const entry = listDeclarationSubjectEntries(database, input.practiceId, input.declarationId).find(
    (candidate) => candidate.id === id,
  );
  if (!entry) throw new Error("SUBJECT_ENTRY_CREATE_FAILED");
  return { entry, revision };
}

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
    const fallbackKind: AssetKind =
      category === "property"
        ? "building"
        : category === "financial"
          ? "securities"
          : category === "liability"
            ? "liability"
            : category === "donation"
              ? "donation"
              : "other";
    const kind =
      typeof data.kind === "string" && data.kind in ASSET_KIND_DETAILS
        ? (data.kind as AssetKind)
        : fallbackKind;
    const details = ASSET_KIND_DETAILS[kind];
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
    category?: AssetCategory;
    kind?: AssetKind;
    displayName: string;
    valueCents?: bigint;
    declarationId?: string;
  },
): SharedAsset {
  const id = randomUUID();
  const now = new Date().toISOString();
  const fallbackKind: AssetKind =
    input.category === "property"
      ? "building"
      : input.category === "financial"
        ? "securities"
        : input.category === "liability"
          ? "liability"
          : input.category === "donation"
            ? "donation"
            : "other";
  const kind = input.kind ?? fallbackKind;
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

function listChecklist(
  database: Database.Database,
  practiceId: string,
  declarationId: string,
): ChecklistItem[] {
  const rows = database
    .prepare(
      `SELECT id, requirement_kind, importance, label, status, source_refs_json,
              document_id, decision_note
       FROM checklist_items WHERE practice_id = ? AND declaration_id = ?
       ORDER BY CASE importance WHEN 'blocking' THEN 0 WHEN 'conditional' THEN 1 ELSE 2 END, label`,
    )
    .all(practiceId, declarationId) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    requirementKind: String(row.requirement_kind) as ChecklistItem["requirementKind"],
    importance: String(row.importance) as ChecklistItem["importance"],
    label: String(row.label),
    status: String(row.status) as ChecklistItem["status"],
    sourceRefs: JSON.parse(String(row.source_refs_json)) as string[],
    documentId: row.document_id === null ? null : String(row.document_id),
    decisionNote: row.decision_note === null ? null : String(row.decision_note),
  }));
}

interface ChecklistRule {
  id: string;
  requirementKind: ChecklistItem["requirementKind"];
  importance: ChecklistItem["importance"];
  label: string;
  applicable: boolean;
  sourceRefs: string[];
}

export function synchronizeChecklist(
  database: Database.Database,
  practiceId: string,
  declarationId: string,
): ChecklistItem[] {
  const record = getDeclaration(database, declarationId, practiceId);
  if (!record) return [];
  const fields = Object.values(record.declaration.fields);
  const assets = listSharedAssets(database, practiceId, declarationId);
  const hasValue = (fragment: string, accepted: string[] = ["1"]) =>
    fields.some(
      (field) => field.fieldId.includes(fragment) && accepted.includes(String(field.value ?? "")),
    );
  const rules: ChecklistRule[] = [
    {
      id: "death-proof",
      requirementKind: "source",
      importance: "blocking",
      label: "Documento che attesta il decesso",
      applicable: true,
      sourceRefs: ["SRC-05#documenti"],
    },
    {
      id: "signed-declaration",
      requirementKind: "retain",
      importance: "blocking",
      label: "Dichiarazione trasmessa e sottoscritta",
      applicable: true,
      sourceRefs: ["SRC-05#documenti-da-conservare"],
    },
    {
      id: "presenter-identity",
      requirementKind: "retain",
      importance: "blocking",
      label: "Documento di identità di chi presenta la dichiarazione",
      applicable: true,
      sourceRefs: ["SRC-05#documenti-da-conservare"],
    },
    {
      id: "second-receipt",
      requirementKind: "subsequent_proof",
      importance: "conditional",
      label: "Seconda ricevuta dell’Agenzia delle Entrate",
      applicable: true,
      sourceRefs: ["SRC-05#ricevute"],
    },
    {
      id: "payment-proof",
      requirementKind: "subsequent_proof",
      importance: "conditional",
      label: "Ricevuta di pagamento o modello F24",
      applicable: true,
      sourceRefs: ["SRC-05#pagamento"],
    },
    {
      id: "will",
      requirementKind: "attachment",
      importance: "blocking",
      label: "Copia del testamento e verbale di pubblicazione",
      applicable: hasValue("DevoluzionePerTestamento") || hasValue("devoluzione.per-testamento"),
      sourceRefs: ["SRC-05#testamento"],
    },
    {
      id: "inventory",
      requirementKind: "attachment",
      importance: "blocking",
      label: "Inventario dell’eredità",
      applicable:
        hasValue("AccettazioneConBeneficioInventario") ||
        hasValue("beneficio-inventario") ||
        assets.some((asset) => asset.kind === "inventory"),
      sourceRefs: ["SRC-05#inventario", "SRC-10#presunzione"],
    },
    {
      id: "liability-proof",
      requirementKind: "source",
      importance: "blocking",
      label: "Documenti che provano le passività indicate",
      applicable: assets.some((asset) => asset.category === "liability"),
      sourceRefs: ["SRC-05#quadro-ed"],
    },
    {
      id: "foreign-tax",
      requirementKind: "attachment",
      importance: "blocking",
      label: "Prova dell’imposta pagata all’estero",
      applicable: fields.some(
        (field) =>
          field.fieldId.includes("ImpostaVersataEstero") &&
          /^\d+$/.test(String(field.value ?? "")) &&
          BigInt(String(field.value)) > 0n,
      ),
      sourceRefs: ["SRC-05#imposta-estera", "SRC-10#detrazione-estero"],
    },
    {
      id: "family-tree",
      requirementKind: "source",
      importance: "recommended",
      label: "Prospetto dei rapporti familiari",
      applicable: true,
      sourceRefs: ["SRC-05#albero-genealogico"],
    },
  ];
  const now = new Date().toISOString();
  const ruleIds = rules.map((rule) => `checklist:${declarationId}:${rule.id}`);
  const existing = new Map(
    listChecklist(database, practiceId, declarationId).map((item) => [item.id, item]),
  );
  const statement = database.prepare(
    `INSERT INTO checklist_items(
       id, practice_id, declaration_id, requirement_kind, importance, label, status,
       source_refs_json, rule_version, document_id, decision_note, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       requirement_kind = excluded.requirement_kind,
       importance = excluded.importance,
       label = excluded.label,
       status = CASE
         WHEN excluded.status = 'not_applicable' THEN 'not_applicable'
         WHEN checklist_items.status = 'not_applicable' THEN 'missing'
         ELSE checklist_items.status
       END,
       source_refs_json = excluded.source_refs_json,
       rule_version = excluded.rule_version,
       updated_at = excluded.updated_at`,
  );
  database.transaction(() => {
    database
      .prepare(
        `DELETE FROM checklist_items
         WHERE practice_id = ? AND declaration_id = ?
           AND id NOT IN (${ruleIds.map(() => "?").join(", ")})`,
      )
      .run(practiceId, declarationId, ...ruleIds);
    for (const rule of rules) {
      const id = `checklist:${declarationId}:${rule.id}`;
      statement.run(
        id,
        practiceId,
        declarationId,
        rule.requirementKind,
        rule.importance,
        rule.label,
        rule.applicable ? (existing.get(id)?.status ?? "missing") : "not_applicable",
        JSON.stringify(rule.sourceRefs),
        SUCCESSION_TAX_RULESET_VERSION,
        now,
        now,
      );
    }
  })();
  return listChecklist(database, practiceId, declarationId);
}

export function updateChecklistItem(
  database: Database.Database,
  input: {
    practiceId: string;
    declarationId: string;
    itemId: string;
    status: ChecklistItem["status"];
    documentId?: string | null;
    decisionNote?: string | null;
  },
): boolean {
  const item = listChecklist(database, input.practiceId, input.declarationId).find(
    (candidate) => candidate.id === input.itemId,
  );
  if (!item || item.status === "not_applicable") return false;
  if (input.status === "overridden" && !input.decisionNote?.trim()) return false;
  const document = input.documentId
    ? database
        .prepare("SELECT 1 FROM documents WHERE id = ? AND practice_id = ?")
        .get(input.documentId, input.practiceId)
    : null;
  if (input.documentId && !document) return false;
  const changed = database
    .prepare(
      `UPDATE checklist_items
       SET status = ?, document_id = ?, decision_note = ?, updated_at = ?
       WHERE id = ? AND practice_id = ? AND declaration_id = ?`,
    )
    .run(
      input.status,
      input.documentId ?? null,
      input.decisionNote?.trim() || null,
      new Date().toISOString(),
      input.itemId,
      input.practiceId,
      input.declarationId,
    ).changes;
  if (changed)
    recordAuditEvent(
      database,
      input.practiceId,
      input.declarationId,
      "checklist.updated",
      "Aggiornato un documento richiesto dalla pratica.",
      { itemId: input.itemId, status: input.status },
    );
  return changed > 0;
}

function serializeBigInts(value: unknown): string {
  return JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item));
}

function parseDevolutionShares(value: string): DevolutionScenario["shares"] {
  const rows = JSON.parse(value) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    assetId: String(row.assetId),
    beneficiaryId: String(row.beneficiaryId),
    numerator: BigInt(String(row.numerator)),
    denominator: BigInt(String(row.denominator)),
    rightCode: String(row.rightCode),
    valueCents: BigInt(String(row.valueCents)),
    reliefCode: String(row.reliefCode ?? ""),
    reductionYears: Number(row.reductionYears ?? 0) as 0 | 1 | 2 | 3 | 4 | 5,
    previousSuccessionValueCents: BigInt(String(row.previousSuccessionValueCents ?? 0)),
    foreignTaxCents: BigInt(String(row.foreignTaxCents ?? 0)),
  }));
}

export function listDevolutionScenarios(
  database: Database.Database,
  practiceId: string,
  declarationId: string,
): DevolutionScenario[] {
  const rows = database
    .prepare(
      `SELECT id, result_json, issues_json, status, updated_at
       FROM devolution_scenarios
       WHERE practice_id = ? AND declaration_id = ?
       ORDER BY updated_at DESC`,
    )
    .all(practiceId, declarationId) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    status: String(row.status) as DevolutionScenario["status"],
    shares: parseDevolutionShares(String(row.result_json)),
    issues: JSON.parse(String(row.issues_json)) as DevolutionIssue[],
    updatedAt: String(row.updated_at),
  }));
}

export function saveDevolutionScenario(
  database: Database.Database,
  input: {
    practiceId: string;
    declarationId: string;
    expectedRevision: number;
    shares: Array<{
      assetId: string;
      beneficiaryId: string;
      numerator: bigint;
      denominator: bigint;
      rightCode: string;
      reliefCode?: string;
      reductionYears?: 0 | 1 | 2 | 3 | 4 | 5;
      previousSuccessionValueCents?: bigint;
      foreignTaxCents?: bigint;
    }>;
  },
): DevolutionScenario {
  const declaration = getDeclaration(database, input.declarationId, input.practiceId);
  if (!declaration) throw new Error("DECLARATION_NOT_FOUND");
  if (declaration.revision !== input.expectedRevision) throw new Error("REVISION_CONFLICT");
  const assets = new Map(
    listSharedAssets(database, input.practiceId, input.declarationId).map((asset) => [
      asset.id,
      asset,
    ]),
  );
  const entries = listDeclarationSubjectEntries(database, input.practiceId, input.declarationId);
  const beneficiaries = new Set(
    entries.filter((entry) => entry.role === "beneficiary").map((entry) => entry.subjectId),
  );
  const issues: DevolutionIssue[] = [];
  const addIssue = (issue: DevolutionIssue) => {
    if (
      !issues.some((candidate) => candidate.id === issue.id && candidate.message === issue.message)
    )
      issues.push(issue);
  };
  for (const share of input.shares) {
    if (!assets.has(share.assetId))
      addIssue({
        id: "DEVOLUTION_ASSET_MISSING",
        message: "Un bene della devoluzione non appartiene più alla pratica.",
        blocking: true,
      });
  }
  for (const asset of assets.values()) {
    if (asset.kind === "donation") continue;
    if (!input.shares.some((share) => share.assetId === asset.id))
      addIssue({
        id: "DEVOLUTION_ASSET_UNASSIGNED",
        message: `Manca la ripartizione di “${asset.displayName}”.`,
        blocking: true,
      });
  }
  const normalizedShares = input.shares
    .filter((share) => assets.has(share.assetId))
    .map((share) => {
      const asset = assets.get(share.assetId)!;
      const rightField = assetCatalogField(asset, "CodiceDiritto_Rip");
      const reliefField = assetCatalogField(asset, "Agevolazioni");
      const rightCode = rightField ? share.rightCode.trim().toUpperCase() : "";
      const reliefCode = share.reliefCode?.trim().toUpperCase() ?? "";
      if (rightField && !listTechnicalEnumerationValues(rightField.canonicalId).includes(rightCode))
        addIssue({
          id: "DEVOLUTION_RIGHT_CODE_INVALID",
          message: `Il codice del diritto indicato per “${asset.displayName}” non è ammesso dalla fonte ufficiale.`,
          blocking: true,
        });
      if (
        reliefCode &&
        (!reliefField ||
          !listTechnicalEnumerationValues(reliefField.canonicalId).includes(reliefCode))
      )
        addIssue({
          id: "DEVOLUTION_RELIEF_CODE_INVALID",
          message: `L’agevolazione indicata per “${asset.displayName}” non è ammessa dalla fonte ufficiale.`,
          blocking: true,
        });
      const reductionYears = share.reductionYears ?? 0;
      const previousSuccessionValueCents = share.previousSuccessionValueCents ?? 0n;
      if (reductionYears > 0 !== previousSuccessionValueCents > 0n)
        addIssue({
          id: "DEVOLUTION_REDUCTION_INCOMPLETE",
          message:
            "Per applicare la riduzione entro cinque anni servono sia il periodo sia il valore della successione precedente.",
          blocking: true,
        });
      return {
        ...share,
        rightCode,
        valueCents: 0n,
        reliefCode,
        reductionYears,
        previousSuccessionValueCents,
        foreignTaxCents: share.foreignTaxCents ?? 0n,
      };
    });
  for (const beneficiaryId of beneficiaries) {
    const beneficiaryEntries = entries.filter((entry) => entry.subjectId === beneficiaryId);
    if (hasAmbiguousTaxPositions(declaration.declaration, beneficiaryEntries))
      addIssue({
        id: "DEVOLUTION_BENEFICIARY_POSITION_AMBIGUOUS",
        message:
          "Il beneficiario compare in più posizioni del Quadro EA: scegli prima quale posizione deve governare il calcolo.",
        blocking: true,
      });
  }
  for (const issue of validateDevolutionScenario(beneficiaries, normalizedShares)) addIssue(issue);
  const shares = normalizedShares.map((share, index, all) => {
    const asset = assets.get(share.assetId)!;
    const grouped = all
      .map((candidate, candidateIndex) => ({ ...candidate, index: candidateIndex }))
      .filter((candidate) => candidate.assetId === share.assetId);
    const allocations = allocateConservedCents(BigInt(asset.valueCents), grouped);
    return { ...share, valueCents: allocations?.get(index) ?? 0n };
  });
  const id = randomUUID();
  const now = new Date().toISOString();
  database.transaction(() => {
    database
      .prepare(
        `INSERT INTO devolution_scenarios(
           id, practice_id, declaration_id, ruleset_version, input_json, result_json,
           issues_json, status, confirmed_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      )
      .run(
        id,
        input.practiceId,
        input.declarationId,
        SUCCESSION_TAX_RULESET_VERSION,
        serializeBigInts(input.shares),
        serializeBigInts(shares),
        JSON.stringify(issues),
        issues.length > 0 ? "blocked" : "draft",
        now,
        now,
      );
    recordAuditEvent(
      database,
      input.practiceId,
      input.declarationId,
      "devolution.created",
      issues.length > 0
        ? "Salvata una proposta di devoluzione da correggere."
        : "Salvata una proposta di devoluzione da confermare.",
      { scenarioId: id, issueCount: issues.length },
    );
  })();
  return listDevolutionScenarios(database, input.practiceId, input.declarationId).find(
    (scenario) => scenario.id === id,
  )!;
}

export function confirmDevolutionScenario(
  database: Database.Database,
  input: {
    practiceId: string;
    declarationId: string;
    scenarioId: string;
    expectedRevision: number;
  },
): number {
  const declaration = getDeclaration(database, input.declarationId, input.practiceId);
  if (!declaration) throw new Error("DECLARATION_NOT_FOUND");
  const scenario = listDevolutionScenarios(database, input.practiceId, input.declarationId).find(
    (candidate) => candidate.id === input.scenarioId,
  );
  if (!scenario || scenario.status !== "draft" || scenario.issues.length > 0)
    throw new Error("DEVOLUTION_NOT_CONFIRMABLE");
  const now = new Date().toISOString();
  const nextDeclaration: DeclarationSnapshot = {
    ...declaration.declaration,
    confirmedDevolutionScenarioId: scenario.id,
    latestCalculationRunId: null,
    decisions: [
      ...declaration.declaration.decisions,
      {
        id: randomUUID(),
        kind: "devolution-confirmed",
        summary: "Confermata professionalmente la ripartizione dei beni e delle passività.",
        sourceRefs: ["SRC-05", "SRC-10"],
        createdAt: now,
      },
    ],
  };
  return database.transaction(() => {
    database
      .prepare(
        `UPDATE devolution_scenarios SET status = 'superseded', updated_at = ?
         WHERE practice_id = ? AND declaration_id = ? AND status = 'confirmed'`,
      )
      .run(now, input.practiceId, input.declarationId);
    database
      .prepare(
        `UPDATE devolution_scenarios
         SET status = 'confirmed', confirmed_at = ?, updated_at = ?
         WHERE id = ? AND practice_id = ? AND declaration_id = ?`,
      )
      .run(now, now, scenario.id, input.practiceId, input.declarationId);
    database
      .prepare(
        `UPDATE calculation_runs SET status = 'superseded', updated_at = ?
         WHERE practice_id = ? AND declaration_id = ? AND status <> 'superseded'`,
      )
      .run(now, input.practiceId, input.declarationId);
    const revision = saveDeclaration(
      database,
      input.declarationId,
      input.expectedRevision,
      nextDeclaration,
    );
    recordAuditEvent(
      database,
      input.practiceId,
      input.declarationId,
      "devolution.confirmed",
      "Confermata la devoluzione della dichiarazione.",
      { scenarioId: scenario.id, revision },
    );
    return revision;
  })();
}

function parseCalculationResult(value: string): {
  beneficiaries: BeneficiaryTaxResult[];
  totalTaxCents: bigint;
} {
  const parsed = JSON.parse(value) as {
    beneficiaries: Array<Record<string, unknown>>;
    totalTaxCents: string;
  };
  const moneyKeys = [
    "qe",
    "qdn",
    "qp",
    "an",
    "fr",
    "qn",
    "pr",
    "qti",
    "isl",
    "reductions",
    "foreignTaxCredit",
    "isn",
  ];
  return {
    beneficiaries: parsed.beneficiaries.map((beneficiary) => {
      const converted = { ...beneficiary };
      for (const key of moneyKeys) converted[key] = BigInt(String(converted[key] ?? 0));
      return converted as unknown as BeneficiaryTaxResult;
    }),
    totalTaxCents: BigInt(parsed.totalTaxCents),
  };
}

export function listCalculationRuns(
  database: Database.Database,
  practiceId: string,
  declarationId: string,
): CalculationRun[] {
  const rows = database
    .prepare(
      `SELECT id, result_json, issues_json, status, updated_at
       FROM calculation_runs
       WHERE practice_id = ? AND declaration_id = ?
       ORDER BY updated_at DESC`,
    )
    .all(practiceId, declarationId) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    status: String(row.status) as CalculationRun["status"],
    ...parseCalculationResult(String(row.result_json)),
    issues: JSON.parse(String(row.issues_json)) as ValidationIssue[],
    updatedAt: String(row.updated_at),
  }));
}

export function runSuccessionCalculation(
  database: Database.Database,
  input: { practiceId: string; declarationId: string },
): CalculationRun {
  const declaration = getDeclaration(database, input.declarationId, input.practiceId);
  if (!declaration) throw new Error("DECLARATION_NOT_FOUND");
  const scenario = listDevolutionScenarios(database, input.practiceId, input.declarationId).find(
    (candidate) => candidate.id === declaration.declaration.confirmedDevolutionScenarioId,
  );
  if (!scenario || scenario.status !== "confirmed") throw new Error("DEVOLUTION_REQUIRED");
  const assets = new Map(
    listSharedAssets(database, input.practiceId, input.declarationId).map((asset) => [
      asset.id,
      asset,
    ]),
  );
  const entries = listDeclarationSubjectEntries(database, input.practiceId, input.declarationId);
  const entriesBySubject = new Map<string, DeclarationSubjectEntry[]>();
  for (const entry of entries) {
    const group = entriesBySubject.get(entry.subjectId) ?? [];
    group.push(entry);
    entriesBySubject.set(entry.subjectId, group);
  }
  const beneficiaryIds = [...new Set(scenario.shares.map((share) => share.beneficiaryId))];
  const issues: ValidationIssue[] = [];
  if (
    declaration.declaration.successionOpenedAt &&
    declaration.declaration.successionOpenedAt < "2025-01-01"
  )
    issues.push({
      id: "CALCULATION_PERIOD_NOT_QUALIFIED",
      level: "blocking",
      fieldId: "frontespizio.defunto.data-decesso",
      message:
        "Il calcolo per successioni aperte prima del 2025 richiede ancora la regola fiscale del periodo corretto.",
      sourceId: "SRC-10",
      sourcePointer: "Regole fiscali applicabili dalla versione 2025",
    });
  const beneficiaries = beneficiaryIds.map((beneficiaryId) => {
    const beneficiaryEntries = entriesBySubject.get(beneficiaryId) ?? [];
    const ambiguous = hasAmbiguousTaxPositions(declaration.declaration, beneficiaryEntries);
    const entry = ambiguous ? undefined : beneficiaryEntries[0];
    if (ambiguous)
      issues.push({
        id: "CALCULATION_BENEFICIARY_POSITION_AMBIGUOUS",
        level: "blocking",
        fieldId: "quadro-ea.soggetto.tipo",
        entityId: beneficiaryId,
        message:
          "Il beneficiario compare in più posizioni del Quadro EA e il calcolo non può scegliere automaticamente quale usare.",
        sourceId: "SRC-09",
        sourcePointer: "Quadro EA — posizioni ripetute",
      });
    const relationshipCode = entry
      ? String(
          getCanonicalField(declaration.declaration, "quadro-ea.soggetto.grado-parentela", entry.id)
            ?.value ?? "",
        )
      : "";
    const subjectType = entry
      ? String(
          getCanonicalField(declaration.declaration, "quadro-ea.soggetto.tipo", entry.id)?.value ??
            "",
        )
      : "";
    const disabled = entry
      ? String(
          getCanonicalField(declaration.declaration, "quadro-ea.soggetto.disabilita", entry.id)
            ?.value ?? "0",
        ) === "1"
      : false;
    if (!entry || !relationshipCode || !subjectType)
      issues.push({
        id: "CALCULATION_BENEFICIARY_DATA_MISSING",
        level: "blocking",
        fieldId: "quadro-ea.soggetto.grado-parentela",
        message: "Completa tipo e grado di parentela di ogni beneficiario prima del calcolo.",
        sourceId: "SRC-10",
        sourcePointer: "pagine 3-5 e appendice",
      });
    return { id: beneficiaryId, relationshipCode, subjectType, disabled };
  });
  const allocations: SuccessionAllocation[] = scenario.shares.map((share) => {
    const asset = assets.get(share.assetId ?? "");
    return {
      assetId: share.assetId ?? "",
      beneficiaryId: share.beneficiaryId,
      treatment: asset?.treatment ?? "estate",
      valueCents: share.valueCents,
      assetValueCents: BigInt(asset?.valueCents ?? 0),
      reliefCode: share.reliefCode,
      reductionYears:
        share.reductionYears === 0 ? undefined : (share.reductionYears as 1 | 2 | 3 | 4 | 5),
      previousSuccessionValueCents: share.previousSuccessionValueCents,
      foreignTaxCents: share.foreignTaxCents,
    };
  });
  const result = calculateSuccessionTax(beneficiaries, allocations);
  const inputJson = serializeBigInts({ beneficiaries, allocations, scenarioId: scenario.id });
  const inputHash = createHash("sha256").update(inputJson).digest("hex");
  const existing = database
    .prepare(
      `SELECT id FROM calculation_runs
       WHERE declaration_id = ? AND ruleset_version = ? AND input_hash = ?`,
    )
    .get(input.declarationId, SUCCESSION_TAX_RULESET_VERSION, inputHash) as
    | { id: string }
    | undefined;
  if (existing)
    return listCalculationRuns(database, input.practiceId, input.declarationId).find(
      (run) => run.id === existing.id,
    )!;
  const id = randomUUID();
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO calculation_runs(
         id, practice_id, declaration_id, ruleset_version, input_hash, input_json,
         result_json, issues_json, status, confirmed_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .run(
      id,
      input.practiceId,
      input.declarationId,
      SUCCESSION_TAX_RULESET_VERSION,
      inputHash,
      inputJson,
      serializeBigInts(result),
      JSON.stringify(issues),
      issues.length > 0 ? "blocked" : "draft",
      now,
      now,
    );
  recordAuditEvent(
    database,
    input.practiceId,
    input.declarationId,
    "calculation.created",
    issues.length > 0
      ? "Eseguito un calcolo con dati da completare."
      : "Eseguito il calcolo dell’imposta da confermare.",
    { calculationId: id, inputHash },
  );
  return listCalculationRuns(database, input.practiceId, input.declarationId).find(
    (run) => run.id === id,
  )!;
}

export function confirmCalculationRun(
  database: Database.Database,
  input: {
    practiceId: string;
    declarationId: string;
    calculationId: string;
    expectedRevision: number;
  },
): number {
  const declaration = getDeclaration(database, input.declarationId, input.practiceId);
  if (!declaration) throw new Error("DECLARATION_NOT_FOUND");
  const calculation = listCalculationRuns(database, input.practiceId, input.declarationId).find(
    (candidate) => candidate.id === input.calculationId,
  );
  if (!calculation || calculation.status !== "draft" || calculation.issues.length > 0)
    throw new Error("CALCULATION_NOT_CONFIRMABLE");
  const now = new Date().toISOString();
  const nextDeclaration: DeclarationSnapshot = {
    ...declaration.declaration,
    latestCalculationRunId: calculation.id,
    decisions: [
      ...declaration.declaration.decisions,
      {
        id: randomUUID(),
        kind: "calculation-confirmed",
        summary: "Confermato professionalmente il calcolo della dichiarazione.",
        sourceRefs: ["SRC-10"],
        createdAt: now,
      },
    ],
  };
  return database.transaction(() => {
    database
      .prepare(
        `UPDATE calculation_runs SET status = 'superseded', updated_at = ?
         WHERE practice_id = ? AND declaration_id = ? AND status = 'confirmed'`,
      )
      .run(now, input.practiceId, input.declarationId);
    database
      .prepare(
        `UPDATE calculation_runs
         SET status = 'confirmed', confirmed_at = ?, updated_at = ?
         WHERE id = ? AND practice_id = ? AND declaration_id = ?`,
      )
      .run(now, now, calculation.id, input.practiceId, input.declarationId);
    const revision = saveDeclaration(
      database,
      input.declarationId,
      input.expectedRevision,
      nextDeclaration,
    );
    recordAuditEvent(
      database,
      input.practiceId,
      input.declarationId,
      "calculation.confirmed",
      "Confermato il calcolo della dichiarazione.",
      { calculationId: calculation.id, revision },
    );
    return revision;
  })();
}

export function saveCanonicalField(
  database: Database.Database,
  input: {
    practiceId: string;
    declarationId: string;
    expectedRevision: number;
    fieldId: string;
    value: string;
    entityId?: string | null;
  },
): { revision: number; issues: ValidationIssue[] } {
  return saveCanonicalFields(database, {
    practiceId: input.practiceId,
    declarationId: input.declarationId,
    expectedRevision: input.expectedRevision,
    entityId: input.entityId,
    fields: [{ fieldId: input.fieldId, value: input.value }],
  });
}

export function saveCanonicalFields(
  database: Database.Database,
  input: {
    practiceId: string;
    declarationId: string;
    expectedRevision: number;
    fields: Array<{ fieldId: string; value: string }>;
    entityId?: string | null;
  },
): { revision: number; issues: ValidationIssue[] } {
  const record = getDeclaration(database, input.declarationId, input.practiceId);
  if (!record) throw new Error("DECLARATION_NOT_FOUND");
  const entityId = input.entityId ?? null;
  const fields = input.fields.filter(
    (field, index, all) =>
      all.findIndex((candidate) => candidate.fieldId === field.fieldId) === index,
  );
  const targetKinds = new Set(
    fields.map((field) => {
      return getCatalogField(field.fieldId)?.entityScope ?? "declaration";
    }),
  );
  if (targetKinds.size > 1) {
    return {
      revision: record.revision,
      issues: [
        {
          id: "FIELD_GROUP_MIXED",
          level: "blocking",
          fieldId: fields[0]?.fieldId ?? null,
          message:
            "Questi dati appartengono a sezioni diverse e devono essere salvati separatamente.",
          sourceId: "SRC-03",
          sourcePointer: "Struttura della dichiarazione",
        },
      ],
    };
  }
  const requiresEaSubject = fields.some(
    (field) => getCatalogField(field.fieldId)?.entityScope === "subject",
  );
  const requiresDecedent = fields.some(
    (field) => getCatalogField(field.fieldId)?.entityScope === "decedent",
  );
  const requiresAsset = fields.some(
    (field) => getCatalogField(field.fieldId)?.entityScope === "asset",
  );
  if (requiresEaSubject && !entityId) {
    return {
      revision: record.revision,
      issues: [
        {
          id: "SUBJECT_REQUIRED",
          level: "blocking",
          fieldId: fields.find((field) => field.fieldId.startsWith("quadro-ea."))?.fieldId ?? null,
          message: "Scegli il soggetto al quale appartiene questo dato.",
          sourceId: "SRC-03",
          sourcePointer: "Quadro EA",
        },
      ],
    };
  }
  if (requiresDecedent && !entityId) {
    return {
      revision: record.revision,
      issues: [
        {
          id: "DECEDENT_REQUIRED",
          level: "blocking",
          fieldId:
            fields.find((field) => getCatalogField(field.fieldId)?.entityScope === "decedent")
              ?.fieldId ?? null,
          message: "Aggiungi il defunto alla pratica prima di compilare questo dato.",
          sourceId: "SRC-03",
          sourcePointer: "Frontespizio — Dati del defunto",
        },
      ],
    };
  }
  if (requiresAsset && !entityId) {
    return {
      revision: record.revision,
      issues: [
        {
          id: "ASSET_REQUIRED",
          level: "blocking",
          fieldId:
            fields.find((field) => getCatalogField(field.fieldId)?.entityScope === "asset")
              ?.fieldId ?? null,
          message: "Scegli il bene o la passività a cui appartengono questi dati.",
          sourceId: "SRC-03",
          sourcePointer: "Quadri dei beni e delle passività",
        },
      ],
    };
  }
  const entry = entityId
    ? listDeclarationSubjectEntries(database, input.practiceId, input.declarationId).find(
        (candidate) => candidate.id === entityId,
      )
    : null;
  const decedent =
    entityId && requiresDecedent
      ? listSharedSubjects(database, input.practiceId).find(
          (candidate) => candidate.id === entityId && candidate.role === "decedent",
        )
      : null;
  const asset =
    entityId && requiresAsset
      ? listSharedAssets(database, input.practiceId, input.declarationId).find(
          (candidate) => candidate.id === entityId,
        )
      : null;
  if (
    (requiresEaSubject && !entry) ||
    (requiresDecedent && !decedent) ||
    (requiresAsset && !asset)
  ) {
    return {
      revision: record.revision,
      issues: [
        {
          id: requiresDecedent
            ? "DECEDENT_NOT_FOUND"
            : requiresAsset
              ? "ASSET_NOT_FOUND"
              : "SUBJECT_NOT_FOUND",
          level: "blocking",
          fieldId: fields[0]?.fieldId ?? null,
          message: requiresDecedent
            ? "Il defunto indicato non appartiene più a questa pratica."
            : requiresAsset
              ? "Il bene indicato non appartiene più a questa pratica."
              : "La posizione scelta non appartiene più a questa dichiarazione.",
          sourceId: "SRC-03",
          sourcePointer: requiresDecedent
            ? "Frontespizio — Dati del defunto"
            : requiresAsset
              ? "Quadri dei beni e delle passività"
              : "Quadro EA",
        },
      ],
    };
  }
  const issues = fields.flatMap((field) =>
    field.value === "" ? [] : validateFieldValue(field.fieldId, field.value),
  );
  const valueField = asset ? officialAssetValueField(asset) : null;
  const officialValue = valueField
    ? fields.find((field) => field.fieldId === valueField.canonicalId)
    : null;
  if (officialValue && wholeEurosToCents(officialValue.value) === null)
    issues.push({
      id: "ASSET_VALUE_FORMAT_INVALID",
      level: "blocking",
      fieldId: officialValue.fieldId,
      entityId: asset?.id ?? null,
      message: "Il valore del bene deve essere indicato in euro interi, usando soltanto cifre.",
      sourceId: valueField?.sourceId ?? "SRC-08",
      sourcePointer: valueField?.sourcePointer ?? "Valore del bene",
    });
  if (issues.some((issue) => issue.level === "blocking"))
    return { revision: record.revision, issues };
  const changedFields = fields.filter(
    (field) =>
      String(getCanonicalField(record.declaration, field.fieldId, entityId)?.value ?? "") !==
      field.value,
  );
  if (changedFields.length === 0) return { revision: record.revision, issues: [] };
  let declaration = record.declaration;
  for (const field of changedFields) {
    declaration = setCanonicalField(
      declaration,
      field.fieldId,
      field.value,
      field.value === "" ? "missing" : "manually_corrected",
      ["manual-entry"],
      entityId,
    );
    if (getCatalogField(field.fieldId)?.technicalPath.endsWith("/DataDecesso"))
      declaration = {
        ...declaration,
        successionOpenedAt: officialDateToIso(field.value),
      };
    if (field.fieldId === "quadro-ea.soggetto.codice-fiscale" && entry) {
      for (const linkedEntry of listDeclarationSubjectEntries(
        database,
        input.practiceId,
        input.declarationId,
      )) {
        if (linkedEntry.subjectId === entry.subjectId && linkedEntry.id !== entry.id) {
          declaration = setCanonicalField(
            declaration,
            field.fieldId,
            field.value,
            field.value === "" ? "missing" : "manually_corrected",
            ["manual-entry"],
            linkedEntry.id,
          );
        }
      }
    }
  }
  declaration = {
    ...declaration,
    confirmedDevolutionScenarioId: null,
    latestCalculationRunId: null,
  };
  const revision = database.transaction(() => {
    const eaTaxCode = changedFields.find(
      (field) => field.fieldId === "quadro-ea.soggetto.codice-fiscale",
    );
    if (eaTaxCode && entry) {
      database
        .prepare(
          `UPDATE shared_subjects
           SET tax_code = ?, revision = revision + 1, updated_at = ?
           WHERE id = ? AND practice_id = ?`,
        )
        .run(eaTaxCode.value || null, new Date().toISOString(), entry.subjectId, input.practiceId);
    }
    if (decedent) {
      const data = { ...decedent.data };
      for (const field of changedFields) {
        if (getCatalogField(field.fieldId)?.entityScope === "decedent")
          data[field.fieldId] = field.value;
      }
      const decedentTaxCode = changedFields.find(
        (field) => field.fieldId === "frontespizio.defunto.codice-fiscale",
      );
      database
        .prepare(
          `UPDATE shared_subjects
           SET data_json = ?, tax_code = CASE WHEN ? THEN ? ELSE tax_code END,
               revision = revision + 1, updated_at = ?
           WHERE id = ? AND practice_id = ?`,
        )
        .run(
          JSON.stringify(data),
          decedentTaxCode ? 1 : 0,
          decedentTaxCode?.value || null,
          new Date().toISOString(),
          decedent.id,
          input.practiceId,
        );
    }
    if (asset) {
      const data = { ...asset.data };
      for (const field of changedFields) data[field.fieldId] = field.value;
      const changedOfficialValue = valueField
        ? changedFields.find((field) => field.fieldId === valueField.canonicalId)
        : null;
      if (changedOfficialValue)
        data.valueCents = String(wholeEurosToCents(changedOfficialValue.value) ?? 0n);
      database
        .prepare(
          `UPDATE shared_assets
           SET data_json = ?, revision = revision + 1, updated_at = ?
           WHERE id = ? AND practice_id = ?`,
        )
        .run(JSON.stringify(data), new Date().toISOString(), asset.id, input.practiceId);
    }
    supersedeDerivedResults(
      database,
      input.practiceId,
      input.declarationId,
      new Date().toISOString(),
    );
    const nextRevision = saveDeclaration(
      database,
      input.declarationId,
      input.expectedRevision,
      declaration,
    );
    recordAuditEvent(
      database,
      input.practiceId,
      input.declarationId,
      "fields.updated",
      changedFields.length === 1
        ? "Aggiornato un dato della dichiarazione."
        : "Aggiornato un gruppo di dati della dichiarazione.",
      { fieldIds: changedFields.map((field) => field.fieldId), entityId, revision: nextRevision },
    );
    return nextRevision;
  })();
  synchronizeChecklist(database, input.practiceId, input.declarationId);
  return { revision, issues: [] };
}

export function listDomainAuditEvents(
  database: Database.Database,
  practiceId: string,
  limit = 20,
): DomainAuditEvent[] {
  return (
    database
      .prepare(
        `SELECT id, event_type, summary, created_at FROM domain_audit_events
       WHERE practice_id = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(practiceId, limit) as Array<Record<string, unknown>>
  ).map((row) => ({
    id: String(row.id),
    eventType: String(row.event_type),
    summary: String(row.summary),
    createdAt: String(row.created_at),
  }));
}

export function listPracticeDomainSummaries(database: Database.Database): PracticeDomainSummary[] {
  const rows = database
    .prepare(
      `SELECT practices.id AS practice_id,
              count(DISTINCT shared_subjects.id) AS subject_count,
              count(DISTINCT shared_assets.id) AS asset_count,
              count(DISTINCT declarations.id) AS declaration_count
       FROM practices
       LEFT JOIN shared_subjects ON shared_subjects.practice_id = practices.id
       LEFT JOIN shared_assets ON shared_assets.practice_id = practices.id
       LEFT JOIN declarations ON declarations.practice_id = practices.id
       WHERE practices.status = 'active'
       GROUP BY practices.id`,
    )
    .all() as Array<{
    practice_id: string;
    subject_count: number;
    asset_count: number;
    declaration_count: number;
  }>;
  return rows.map((row) => {
    if (row.subject_count === 0)
      return {
        practiceId: row.practice_id,
        subjectCount: row.subject_count,
        assetCount: row.asset_count,
        declarationCount: row.declaration_count,
        label: "Da impostare" as const,
        nextStep: "Aggiungi il defunto e i beneficiari",
      };
    if (row.asset_count === 0)
      return {
        practiceId: row.practice_id,
        subjectCount: row.subject_count,
        assetCount: row.asset_count,
        declarationCount: row.declaration_count,
        label: "Da completare" as const,
        nextStep: "Registra beni e passività",
      };
    return {
      practiceId: row.practice_id,
      subjectCount: row.subject_count,
      assetCount: row.asset_count,
      declarationCount: row.declaration_count,
      label: "In controllo" as const,
      nextStep: "Completa i controlli della dichiarazione",
    };
  });
}

function requiredFieldIssues(
  database: Database.Database,
  practiceId: string,
  declarationId: string,
  declaration: DeclarationSnapshot,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const subjects = listDeclarationSubjectEntries(database, practiceId, declarationId);
  const decedent = listSharedSubjects(database, practiceId).find(
    (subject) => subject.role === "decedent",
  );
  const assets = listSharedAssets(database, practiceId, declarationId);
  const entityNames = new Map<string, string>([
    ...subjects.map((subject) => [subject.id, subject.displayName] as const),
    ...(decedent ? [[decedent.id, decedent.displayName] as const] : []),
    ...assets.map((asset) => [asset.id, asset.displayName] as const),
  ]);
  const active: Array<{ quadro: QuadroId; entityIds: Array<string | null> }> = [
    { quadro: "Frontespizio", entityIds: [null] },
    { quadro: "EA", entityIds: subjects.map((subject) => subject.id) },
    ...([...new Set(assets.map((asset) => asset.quadro).filter(Boolean))] as QuadroId[]).map(
      (quadro) => ({
        quadro,
        entityIds: assets.filter((asset) => asset.quadro === quadro).map((asset) => asset.id),
      }),
    ),
  ];
  for (const context of active) {
    for (const field of listQuadroFields(context.quadro)) {
      if (
        field.entryMode === "derived" ||
        field.effectiveMinOccurs === 0 ||
        field.choiceGroup !== null
      )
        continue;
      const entityIds =
        field.entityScope === "decedent" ? [decedent?.id ?? null] : context.entityIds;
      for (const entityId of entityIds) {
        const value = getCanonicalField(declaration, field.canonicalId, entityId)?.value;
        if (value !== null && value !== undefined && String(value) !== "") continue;
        issues.push({
          id: `REQUIRED_FIELD_MISSING:${field.canonicalId}:${entityId ?? "declaration"}`,
          level: "blocking",
          fieldId: field.canonicalId,
          entityId,
          message: entityId
            ? `Completa “${field.label}” per ${entityNames.get(entityId) ?? "la posizione interessata"}.`
            : `Completa “${field.label}” nel ${context.quadro === "Frontespizio" ? "Frontespizio" : `Quadro ${context.quadro}`}.`,
          sourceId: field.sourceId,
          sourcePointer: field.sourcePointer,
        });
      }
    }
  }
  return issues;
}

export function buildComplianceReport(
  database: Database.Database,
  practiceId: string,
  declarationId: string,
): {
  declaration: DeclarationSnapshot;
  issues: ValidationIssue[];
  checklist: ChecklistItem[];
  ready: boolean;
  digest: string;
} {
  const record = getDeclaration(database, declarationId, practiceId);
  const declaration = record?.declaration ?? createEmptyDeclaration();
  const entries = listDeclarationSubjectEntries(database, practiceId, declarationId);
  const assets = listSharedAssets(database, practiceId, declarationId).filter(
    (asset) => asset.kind !== "donation",
  );
  const entityNames = new Map<string, string>([
    ...listSharedSubjects(database, practiceId).map(
      (subject) => [subject.id, subject.displayName] as const,
    ),
    ...entries.map((entry) => [entry.id, entry.displayName] as const),
    ...assets.map((asset) => [asset.id, asset.displayName] as const),
  ]);
  const issues = [
    ...validateDeclaration(declaration).map((issue) => {
      const entityName = issue.entityId ? entityNames.get(issue.entityId) : null;
      if (!entityName) return issue;
      const label = issue.fieldId ? getCatalogField(issue.fieldId)?.label : null;
      return {
        ...issue,
        message: issue.id.startsWith("PROFESSIONAL_CONFIRMATION_REQUIRED:")
          ? `Conferma professionalmente “${label ?? "questo dato"}” per ${entityName}.`
          : `${issue.message.replace(/\.$/, "")} per ${entityName}.`,
      };
    }),
    ...validateRepeatedEaSubjects(declaration, entries),
    ...requiredFieldIssues(database, practiceId, declarationId, declaration),
  ];
  if (getCatalogStatus().status !== "qualified") {
    issues.push({
      id: "OFFICIAL_RULES_INCOMPLETE",
      level: "blocking",
      fieldId: null,
      message: "Le fonti ministeriali non sono ancora completamente riconciliate.",
      sourceId: "SRC-03/SRC-08",
      sourcePointer: "official-catalog.json",
    });
  }
  const checklist = synchronizeChecklist(database, practiceId, declarationId);
  if (checklist.some((item) => item.importance === "blocking" && item.status === "missing")) {
    issues.push({
      id: "CHECKLIST_BLOCKING_MISSING",
      level: "blocking",
      fieldId: null,
      message: "Manca almeno un documento obbligatorio per questa dichiarazione.",
      sourceId: "SRC-05",
      sourcePointer: "checklist_items",
    });
  }
  if (assets.length > 0 && !declaration.confirmedDevolutionScenarioId)
    issues.push({
      id: "DEVOLUTION_CONFIRMATION_REQUIRED",
      level: "blocking",
      fieldId: null,
      message: "Conferma la ripartizione dei beni e delle passività.",
      sourceId: "SRC-05/SRC-10",
      sourcePointer: "devolution_scenarios",
    });
  if (
    assets.length > 0 &&
    declaration.successionOpenedAt !== null &&
    declaration.successionOpenedAt >= "2025-01-01" &&
    !declaration.latestCalculationRunId
  )
    issues.push({
      id: "CALCULATION_CONFIRMATION_REQUIRED",
      level: "blocking",
      fieldId: null,
      message: "Esegui e conferma il calcolo dell’imposta.",
      sourceId: "SRC-10",
      sourcePointer: "calculation_runs",
    });
  const uniqueIssues = [
    ...new Map(
      issues.map((issue) => [
        `${issue.level}:${issue.message}:${issue.sourceId}:${issue.sourcePointer}`,
        issue,
      ]),
    ).values(),
  ];
  const canonical = JSON.stringify({ declaration, issues: uniqueIssues, checklist });
  return {
    declaration: parseDeclaration(declaration),
    issues: uniqueIssues,
    checklist,
    ready: !uniqueIssues.some((issue) => issue.level === "blocking"),
    digest: createHash("sha256").update(canonical).digest("hex"),
  };
}
