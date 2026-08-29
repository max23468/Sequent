import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  calculateDeclarationTaxSummary,
  calculateSuccessionTax,
  SUCCESSION_TAX_RULESET_VERSION,
  type BeneficiaryTaxResult,
  type DeclarationTaxSummary,
  type SuccessionAllocation,
} from "../../domain/calculation.ts";
import { addSnapshotAutomaticOfficialFieldValues } from "../../domain/automatic-official-fields.ts";
import { calculateOfficialJurisdictionCounts } from "../../domain/municipality-conservatory.ts";
import {
  buildSuccessionPaymentPlan,
  ordinaryDeclarationDeadline,
  TEMPORAL_RULESET_VERSION,
  type SuccessionPaymentPlan,
} from "../../domain/temporal-rules.ts";
import controlQualification from "../../domain/official-catalog/suc13-control-qualification.json" with { type: "json" };
import {
  canonicalFieldKey,
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
  getQuadroActivationRootPath,
  listOfficialInstructions,
  listQuadroFields,
  listQuadroTechnicalElements,
  listTechnicalEnumerationValues,
  QUADRI,
  type TechnicalElement,
  type QuadroId,
} from "../../domain/official-catalog/catalog.ts";
import {
  validateDeclaration,
  validateFieldValue,
  validateRepeatedEaSubjects,
  type ValidationIssue,
} from "../../domain/validation.ts";
import { getDeclaration, listPractices, saveDeclaration } from "./practices.ts";
import { listOfficialAttachments } from "./official-attachments.ts";

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

const SUCCESSION_OPENING_DATE_FIELD_ID = "frontespizio.defunto.data-decesso";
const SUBSTITUTE_SUCCESSION_OPENING_DATE_FIELD_ID =
  "xsd:/Fornitura/Dichiarazione/QuadroEH/PrimoModulo/SezioneI_DichSost/DatiDefunto/Decesso/DataDecesso";

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

function officialAssetForeignTaxField(asset: SharedAsset) {
  return assetCatalogField(asset, "ImpostaVersataEstero");
}

function officialAssetPreviousSuccessionField(asset: SharedAsset) {
  return assetCatalogField(asset, "ValorePrecSucc");
}

function wholeEurosToCents(value: string): bigint | null {
  return /^\d+$/u.test(value) ? BigInt(value) * 100n : value === "" ? 0n : null;
}

function technicalFieldValue(declaration: DeclarationSnapshot, path: string): string {
  const value = getCanonicalField(declaration, `xsd:${path}`)?.value;
  return value === null || value === undefined ? "" : String(value);
}

function technicalWholeEuroCents(declaration: DeclarationSnapshot, path: string): bigint | null {
  return wholeEurosToCents(technicalFieldValue(declaration, path));
}

const EF_PATH = "/Fornitura/Dichiarazione/QuadroEF";

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

export interface DeclarationDossierSubject {
  id: string;
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
  declarationTaxes: DeclarationTaxSummary;
  paymentPlan: SuccessionPaymentPlan | null;
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

export interface PracticeDeadlineSummary {
  practiceId: string;
  practiceTitle: string;
  label: "Presentazione della dichiarazione";
  dueDate: string | null;
  timing: "overdue" | "today" | "soon" | "upcoming" | "unqualified";
  timingLabel: string;
  sourceId: "SRC-05";
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

function localTodayIso(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
             declaration_id, entry_id, subject_id, sequence, created_at,
             role_snapshot, display_name_snapshot, tax_code_snapshot
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          declaration.id,
          id,
          id,
          sequence,
          now,
          input.role,
          input.displayName,
          input.taxCode || null,
        );
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
              coalesce(declaration_subject_entries.role_snapshot, shared_subjects.role) AS role,
              coalesce(
                declaration_subject_entries.display_name_snapshot,
                shared_subjects.display_name
              ) AS display_name,
              declaration_subject_entries.tax_code_snapshot AS tax_code
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

export function listDeclarationDossierSubjects(
  database: Database.Database,
  practiceId: string,
  declarationId: string,
): DeclarationDossierSubject[] {
  const decedent = listSharedSubjects(database, practiceId).find(
    (subject) => subject.role === "decedent",
  );
  const entries = listDeclarationSubjectEntries(database, practiceId, declarationId);
  const seen = new Set<string>();
  const subjects: DeclarationDossierSubject[] = decedent
    ? [
        {
          id: decedent.id,
          role: decedent.role,
          displayName: decedent.displayName,
          taxCode: decedent.taxCode,
        },
      ]
    : [];
  for (const entry of entries) {
    if (seen.has(entry.subjectId)) continue;
    seen.add(entry.subjectId);
    subjects.push({
      id: entry.subjectId,
      role: entry.role,
      displayName: entry.displayName,
      taxCode: entry.taxCode,
    });
  }
  return subjects;
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
           declaration_id, entry_id, subject_id, sequence, created_at,
           role_snapshot, display_name_snapshot, tax_code_snapshot
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.declarationId,
        id,
        source.subjectId,
        sequence,
        now,
        source.role,
        source.displayName,
        source.taxCode,
      );
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
  const scenarios = listDevolutionScenarios(database, practiceId, declarationId);
  const checklistScenario = record.declaration.confirmedDevolutionScenarioId
    ? scenarios.find((scenario) => scenario.id === record.declaration.confirmedDevolutionScenarioId)
    : scenarios.at(0);
  const reliefCodes = new Set(
    checklistScenario?.shares.map((share) => share.reliefCode).filter(Boolean) ?? [],
  );
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
      requirementKind: "attachment",
      importance: "blocking",
      label: "Prospetto dei rapporti familiari",
      applicable: true,
      sourceRefs: ["SRC-05#quali-documenti-occorrono"],
    },
    {
      id: "family-status-declaration",
      requirementKind: "attachment",
      importance: "blocking",
      label: "Dichiarazione sostitutiva sullo stato di famiglia",
      applicable:
        hasValue("CodiceCarica", ["5", "6", "7"]) || hasValue("codice-carica", ["5", "6", "7"]),
      sourceRefs: ["SRC-05#quali-documenti-occorrono"],
    },
    {
      id: "relief-proof",
      requirementKind: "attachment",
      importance: "blocking",
      label: "Richiesta e documenti per agevolazioni o riduzioni",
      applicable:
        reliefCodes.size > 0 ||
        checklistScenario?.shares.some(
          (share) => share.reductionYears > 0 || share.previousSuccessionValueCents > 0n,
        ) === true,
      sourceRefs: ["SRC-05#quali-documenti-occorrono", "SRC-10#riduzioni"],
    },
    {
      id: "business-continuation",
      requirementKind: "attachment",
      importance: "blocking",
      label: "Impegno a proseguire l’attività o mantenere il controllo per cinque anni",
      applicable: reliefCodes.has("A") || reliefCodes.has("N"),
      sourceRefs: ["SRC-05#quali-documenti-occorrono"],
    },
    {
      id: "company-balance-sheet",
      requirementKind: "attachment",
      importance: "blocking",
      label: "Ultimo bilancio, inventario o prospetto dell’azienda",
      applicable: assets.some((asset) => asset.kind === "company"),
      sourceRefs: ["SRC-05#quali-documenti-occorrono"],
    },
    {
      id: "trust-instrument",
      requirementKind: "attachment",
      importance: "blocking",
      label: "Atto istitutivo, statuto e atto dispositivo del trust",
      applicable:
        hasValue("TipoSoggetto", ["5"]) ||
        hasValue("soggetto.tipo", ["5"]) ||
        hasValue("CodiceCarica", ["9"]) ||
        hasValue("codice-carica", ["9"]),
      sourceRefs: ["SRC-05#quali-documenti-occorrono", "SRC-13#trust"],
    },
    {
      id: "disabled-trust-declaration",
      requirementKind: "attachment",
      importance: "blocking",
      label: "Dichiarazione sui requisiti del trust in favore di persone con disabilità",
      applicable:
        (hasValue("TipoSoggetto", ["5"]) || hasValue("soggetto.tipo", ["5"])) &&
        (hasValue("PortatoreHandicap") || hasValue("soggetto.disabilita")),
      sourceRefs: ["SRC-05#quali-documenti-occorrono"],
    },
    {
      id: "first-home-declaration",
      requirementKind: "attachment",
      importance: "blocking",
      label: "Dichiarazione e documenti per l’agevolazione prima casa",
      applicable: ["P", "X", "Y", "Z"].some((code) => reliefCodes.has(code)),
      sourceRefs: ["SRC-05#quali-documenti-occorrono", "SRC-01#quadro-eh"],
    },
    {
      id: "first-home-natural-event",
      requirementKind: "attachment",
      importance: "blocking",
      label: "Certificazione di inagibilità dell’abitazione già agevolata",
      applicable: hasValue("EventiEccezionali") || hasValue("eventi-eccezionali"),
      sourceRefs: ["SRC-05#eventi-eccezionali"],
    },
    {
      id: "identity-substitute-signers",
      requirementKind: "attachment",
      importance: "blocking",
      label: "Documenti d’identità di chi firma dichiarazioni sostitutive allegate",
      applicable:
        hasValue("QuadroEH") ||
        ["P", "X", "Y", "Z"].some((code) => reliefCodes.has(code)) ||
        reliefCodes.size > 0,
      sourceRefs: ["SRC-05#quali-documenti-occorrono"],
    },
    {
      id: "foreign-asset-certificates",
      requirementKind: "attachment",
      importance: "blocking",
      label: "Certificati dei beni registrati all’estero e attestazione di conformità",
      applicable:
        assets.some((asset) => ["aircraft", "vessel"].includes(asset.kind)) &&
        (hasValue("BeneEstero") || hasValue("bene-estero")),
      sourceRefs: ["SRC-05#quali-documenti-occorrono"],
    },
    {
      id: "foreign-document-translation",
      requirementKind: "attachment",
      importance: "blocking",
      label: "Traduzione asseverata dei documenti in lingua straniera",
      applicable:
        hasValue("StatoEstero", fields.map((field) => String(field.value ?? "")).filter(Boolean)) ||
        hasValue("ResidenzaEstera"),
      sourceRefs: ["SRC-05#quali-documenti-occorrono"],
    },
    {
      id: "renunciation-deed",
      requirementKind: "source",
      importance: "recommended",
      label: "Atto di rinuncia all’eredità o al legato",
      applicable: hasValue("Rinuncia") || hasValue("rinuncia"),
      sourceRefs: ["SRC-05#documenti-consigliati"],
    },
    {
      id: "land-planning-declaration",
      requirementKind: "source",
      importance: "recommended",
      label: "Dichiarazione sulla destinazione urbanistica dei terreni",
      applicable: assets.some((asset) => ["land", "tavolare_land"].includes(asset.kind)),
      sourceRefs: ["SRC-05#documenti-consigliati"],
    },
    {
      id: "substitute-reference",
      requirementKind: "source",
      importance: "blocking",
      label: "Estremi e copia della prima dichiarazione sostituita",
      applicable: record.declaration.declarationKind !== "first",
      sourceRefs: ["SRC-05#dichiarazione-sostitutiva"],
    },
    {
      id: "substitute-originals",
      requirementKind: "retain",
      importance: "blocking",
      label: "Originali delle dichiarazioni sostitutive e documenti d’identità",
      applicable: true,
      sourceRefs: ["SRC-05#documenti-da-conservare"],
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
  if (item.importance === "blocking" && input.status === "overridden") return false;
  if (input.status === "overridden" && !input.decisionNote?.trim()) return false;
  if (input.status === "available" && !input.documentId) return false;
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
    const valueField = officialAssetValueField(asset);
    const officialValue = valueField
      ? getCanonicalField(declaration.declaration, valueField.canonicalId, asset.id)?.value
      : null;
    if (officialValue === null || officialValue === undefined || String(officialValue) === "")
      addIssue({
        id: "DEVOLUTION_OFFICIAL_ASSET_VALUE_MISSING",
        message: `Verifica il valore fiscale di “${asset.displayName}” nel Quadro ${asset.quadro} prima della ripartizione.`,
        blocking: true,
      });
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
  for (const asset of assets.values()) {
    if (asset.kind === "donation") continue;
    const assetShares = normalizedShares.filter((share) => share.assetId === asset.id);
    if (assetShares.length === 0) continue;
    const previousField = officialAssetPreviousSuccessionField(asset);
    const officialValue = previousField
      ? getCanonicalField(declaration.declaration, previousField.canonicalId, asset.id)?.value
      : null;
    const officialText =
      officialValue === null || officialValue === undefined ? "" : String(officialValue);
    const officialPreviousCents = wholeEurosToCents(officialText);
    const hasConfiguredReduction = assetShares.some(
      (share) => share.reductionYears > 0 || share.previousSuccessionValueCents > 0n,
    );
    const hasOfficialPreviousValue = officialPreviousCents !== null && officialPreviousCents > 0n;
    if (!hasConfiguredReduction && !hasOfficialPreviousValue) continue;
    if (!previousField || officialText === "")
      addIssue({
        id: "DEVOLUTION_OFFICIAL_PREVIOUS_SUCCESSION_VALUE_MISSING",
        message: `Completa il valore da precedenti successioni per “${asset.displayName}” nel Quadro ufficiale.`,
        blocking: true,
      });
    const reductionPeriods = new Set(assetShares.map((share) => share.reductionYears));
    if (reductionPeriods.size !== 1 || reductionPeriods.has(0))
      addIssue({
        id: "DEVOLUTION_REDUCTION_PERIOD_INCONSISTENT",
        message: `Indica lo stesso periodo di riduzione per tutte le quote di “${asset.displayName}”.`,
        blocking: true,
      });
    if (
      officialPreviousCents !== null &&
      assetShares.some((share) => share.previousSuccessionValueCents !== officialPreviousCents)
    )
      addIssue({
        id: "DEVOLUTION_PREVIOUS_SUCCESSION_VALUE_DIVERGENCE",
        message: `Ogni quota di “${asset.displayName}” deve usare il valore da precedenti successioni indicato nel Quadro ufficiale.`,
        blocking: true,
      });
  }
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
  declarationTaxes: DeclarationTaxSummary;
  paymentPlan: SuccessionPaymentPlan | null;
} {
  const parsed = JSON.parse(value) as {
    beneficiaries: Array<Record<string, unknown>>;
    totalTaxCents: string;
    declarationTaxes: Record<string, unknown>;
    paymentPlan: Record<string, unknown> | null;
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
  const reviveBigInts = <T>(input: unknown): T => {
    if (Array.isArray(input)) return input.map((item) => reviveBigInts(item)) as T;
    if (input && typeof input === "object")
      return Object.fromEntries(
        Object.entries(input).map(([key, item]) => [
          key,
          key.endsWith("Cents") && typeof item === "string" ? BigInt(item) : reviveBigInts(item),
        ]),
      ) as T;
    return input as T;
  };
  return {
    beneficiaries: parsed.beneficiaries.map((beneficiary) => {
      const converted = { ...beneficiary };
      for (const key of moneyKeys) converted[key] = BigInt(String(converted[key] ?? 0));
      return converted as unknown as BeneficiaryTaxResult;
    }),
    totalTaxCents: BigInt(parsed.totalTaxCents),
    declarationTaxes: reviveBigInts<DeclarationTaxSummary>(parsed.declarationTaxes),
    paymentPlan: parsed.paymentPlan
      ? reviveBigInts<SuccessionPaymentPlan>(parsed.paymentPlan)
      : null,
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

export function getAutomaticOfficialFieldValues(
  database: Database.Database,
  practiceId: string,
  declarationId: string,
): { values: Record<string, string>; updatedAt: string; calculationId: string } | null {
  const declaration = getDeclaration(database, declarationId, practiceId);
  if (!declaration?.declaration.latestCalculationRunId) return null;
  const calculation = listCalculationRuns(database, practiceId, declarationId).find(
    (candidate) =>
      candidate.id === declaration.declaration.latestCalculationRunId &&
      candidate.status === "confirmed",
  );
  if (!calculation) return null;
  return {
    values: calculation.declarationTaxes.officialFieldValues,
    updatedAt: calculation.updatedAt,
    calculationId: calculation.id,
  };
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
  const openingDateIssue = successionOpeningDateDivergenceIssue(declaration.declaration);
  if (openingDateIssue) issues.push(openingDateIssue);
  const catalogStatus = getCatalogStatus();
  if (catalogStatus.status !== "qualified")
    issues.push({
      id: "CALCULATION_RULES_INCOMPLETE",
      level: "blocking",
      fieldId: null,
      message:
        "Il calcolo resta provvisorio finché tutte le regole fiscali applicabili non sono state verificate.",
      sourceId: "SRC-10",
      sourcePointer: "Catalogo delle regole di calcolo e relativi limiti di copertura",
    });
  if (!declaration.declaration.successionOpenedAt)
    issues.push({
      id: "CALCULATION_OPENING_DATE_MISSING",
      level: "blocking",
      fieldId: "frontespizio.defunto.data-decesso",
      message: "Indica la data del decesso prima di confermare il calcolo.",
      sourceId: "SRC-03",
      sourcePointer: "Frontespizio — data del decesso",
    });
  else if (declaration.declaration.successionOpenedAt > localTodayIso())
    issues.push({
      id: "CALCULATION_OPENING_DATE_FUTURE",
      level: "blocking",
      fieldId: SUCCESSION_OPENING_DATE_FIELD_ID,
      message: "La data del decesso non può essere successiva alla data odierna.",
      sourceId: "SRC-03",
      sourcePointer: "Frontespizio — data del decesso",
    });
  else if (declaration.declaration.successionOpenedAt < "2025-01-01")
    issues.push({
      id: "CALCULATION_PERIOD_NOT_QUALIFIED",
      level: "blocking",
      fieldId: "frontespizio.defunto.data-decesso",
      message:
        "Il calcolo per successioni aperte prima del 2025 richiede ancora la regola fiscale del periodo corretto.",
      sourceId: "SRC-10",
      sourcePointer: "Regole fiscali applicabili dalla versione 2025",
    });
  for (const asset of assets.values()) {
    const officialField = officialAssetForeignTaxField(asset);
    const officialValue = officialField
      ? getCanonicalField(declaration.declaration, officialField.canonicalId, asset.id)?.value
      : null;
    const officialForeignTaxCents = wholeEurosToCents(String(officialValue ?? ""));
    const allocatedForeignTaxCents = scenario.shares
      .filter((share) => share.assetId === asset.id)
      .reduce((total, share) => total + share.foreignTaxCents, 0n);
    if (officialForeignTaxCents === null || allocatedForeignTaxCents !== officialForeignTaxCents)
      issues.push({
        id: "CALCULATION_FOREIGN_TAX_DIVERGENCE",
        level: "blocking",
        fieldId: officialField?.canonicalId ?? null,
        entityId: asset.id,
        message:
          "L’imposta estera ripartita tra i beneficiari deve coincidere con quella indicata nel Quadro del bene.",
        sourceId: officialField?.sourceIds[0] ?? "SRC-10",
        sourcePointer: officialField?.sourcePointer ?? "Imposta pagata all’estero",
      });
  }
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
  const currentShareValues = new Map<number, bigint>();
  for (const asset of assets.values()) {
    const assetShares = scenario.shares.flatMap((share, index) =>
      share.assetId === asset.id
        ? [{ index, numerator: share.numerator, denominator: share.denominator }]
        : [],
    );
    if (assetShares.length === 0) continue;
    const allocated = allocateConservedCents(BigInt(asset.valueCents), assetShares);
    if (!allocated) {
      issues.push({
        id: "CALCULATION_OFFICIAL_VALUE_ALLOCATION_INVALID",
        level: "blocking",
        fieldId: null,
        entityId: asset.id,
        message:
          "Le quote del bene non consentono di ripartire correttamente il valore fiscale indicato nel Quadro.",
        sourceId: "SRC-10",
        sourcePointer: "Valore fiscale e devoluzione del bene",
      });
      continue;
    }
    for (const [index, value] of allocated) currentShareValues.set(index, value);
  }
  const allocations: SuccessionAllocation[] = scenario.shares.map((share, index) => {
    const asset = assets.get(share.assetId ?? "");
    const beneficiary = beneficiaries.find((candidate) => candidate.id === share.beneficiaryId);
    const municipalityField = asset ? assetCatalogField(asset, "CodiceComuneAmministrativo") : null;
    const provinceField = asset ? assetCatalogField(asset, "Provincia") : null;
    const habitationRightField = asset ? assetCatalogField(asset, "DirittoAbitazione") : null;
    const landTypeField = asset ? assetCatalogField(asset, "TipologiaTerreno") : null;
    const businessAssetField = asset ? assetCatalogField(asset, "BeneAziendale") : null;
    const exemptValueField = asset ? assetCatalogField(asset, "ValoreEsente") : null;
    const canonicalAssetValue = (field: ReturnType<typeof assetCatalogField>) =>
      asset && field
        ? String(
            getCanonicalField(declaration.declaration, field.canonicalId, asset.id)?.value ?? "",
          )
        : undefined;
    return {
      assetId: share.assetId ?? "",
      beneficiaryId: share.beneficiaryId,
      treatment: asset?.treatment ?? "estate",
      valueCents: currentShareValues.get(index) ?? 0n,
      assetValueCents: BigInt(asset?.valueCents ?? 0),
      assetExemptValueCents: wholeEurosToCents(canonicalAssetValue(exemptValueField) ?? "") ?? 0n,
      businessAsset: canonicalAssetValue(businessAssetField) === "1",
      reliefCode: share.reliefCode,
      reductionYears:
        share.reductionYears === 0 ? undefined : (share.reductionYears as 1 | 2 | 3 | 4 | 5),
      previousSuccessionValueCents: share.previousSuccessionValueCents,
      foreignTaxCents: share.foreignTaxCents,
      assetKind: asset?.kind,
      municipalityCode: canonicalAssetValue(municipalityField),
      provinceCode: canonicalAssetValue(provinceField),
      habitationRightCode: canonicalAssetValue(habitationRightField),
      landTypeCode: canonicalAssetValue(landTypeField),
      relationshipCode: beneficiary?.relationshipCode,
      subjectType: beneficiary?.subjectType,
      rightCode: share.rightCode,
    };
  });
  const result = calculateSuccessionTax(beneficiaries, allocations);
  const mortgageJurisdictionText = technicalFieldValue(
    declaration.declaration,
    `${EF_PATH}/SezioneIII_TassaIpotecaria/Circoscrizioni_Numero`,
  );
  const stampDutyJurisdictionText = technicalFieldValue(
    declaration.declaration,
    `${EF_PATH}/SezioneIV_ImpostaBollo/Circoscrizioni_Numero`,
  );
  const parseDeclaredJurisdictionCount = (value: string): number | undefined =>
    value === "" ? undefined : /^\d+$/u.test(value) ? Number(value) : Number.NaN;
  const declaredMortgageJurisdictionCount =
    parseDeclaredJurisdictionCount(mortgageJurisdictionText);
  const declaredStampDutyJurisdictionCount =
    parseDeclaredJurisdictionCount(stampDutyJurisdictionText);
  const centsAt = (path: string) =>
    technicalWholeEuroCents(declaration.declaration, `${EF_PATH}/${path}`) ?? 0n;
  const paymentTimingText = technicalFieldValue(
    declaration.declaration,
    `${EF_PATH}/SezioneVBis_ImpostaSuccessione/ImpostaCalcolata/TempisticaPagamento`,
  );
  const paymentTiming = paymentTimingText === "2" ? 2 : 1;
  const installmentText = technicalFieldValue(
    declaration.declaration,
    `${EF_PATH}/SezioneVBis_ImpostaSuccessione/ImpostaCalcolata/PagamentoRateale`,
  );
  const installmentCount = /^\d+$/u.test(installmentText) ? Number(installmentText) : undefined;
  const initialPaymentText = technicalFieldValue(
    declaration.declaration,
    `${EF_PATH}/SezioneVBis_ImpostaSuccessione/ImpostaCalcolata/Acconto`,
  );
  const initialPaymentCents = wholeEurosToCents(initialPaymentText);
  const openingDateForCalculation =
    declaration.declaration.successionOpenedAt &&
    declaration.declaration.successionOpenedAt >= "2006-10-03" &&
    declaration.declaration.successionOpenedAt <= "2026-12-31"
      ? declaration.declaration.successionOpenedAt
      : "2026-08-27";
  const presenterCode = technicalFieldValue(
    declaration.declaration,
    "/Fornitura/Dichiarazione/Frontespizio/Presentatore/CodiceCarica",
  );
  const substituteType =
    declaration.declaration.declarationKind === "first"
      ? undefined
      : (declaration.declaration.declarationKind.slice(-1) as "1" | "2" | "3");
  const jurisdictionCounts = calculateOfficialJurisdictionCounts(
    allocations,
    declaration.declaration.declarationKind,
    {
      mortgage: declaredMortgageJurisdictionCount,
      stampDuty: declaredStampDutyJurisdictionCount,
    },
  );
  for (const municipalityCode of jurisdictionCounts.unresolvedMunicipalityCodes)
    issues.push({
      id: "CALCULATION_CONSERVATORY_NOT_FOUND",
      level: "blocking",
      fieldId: null,
      message: municipalityCode
        ? `Il Comune amministrativo ${municipalityCode} non è presente nella mappa ufficiale delle conservatorie.`
        : "Indica il Comune amministrativo per ogni immobile soggetto a pubblicità immobiliare.",
      sourceId: "SRC-39",
      sourcePointer:
        "it/finanze/entrate/sco/resources/comuni_conservatorie.res e regole SUC13 TassaIpotecaria/ImpostaDiBollo",
    });
  if (jurisdictionCounts.mode === "professional-input") {
    const jurisdictionFields = [
      {
        kind: "MORTGAGE",
        status: jurisdictionCounts.declaredCountStatus.mortgage,
        fieldId: `xsd:${EF_PATH}/SezioneIII_TassaIpotecaria/Circoscrizioni_Numero`,
        row: "EF15",
        taxLabel: "tassa ipotecaria",
        maximum: jurisdictionCounts.mortgageMaximum,
      },
      {
        kind: "STAMP_DUTY",
        status: jurisdictionCounts.declaredCountStatus.stampDuty,
        fieldId: `xsd:${EF_PATH}/SezioneIV_ImpostaBollo/Circoscrizioni_Numero`,
        row: "EF16",
        taxLabel: "imposta di bollo",
        maximum: jurisdictionCounts.stampDutyMaximum,
      },
    ] as const;
    for (const field of jurisdictionFields) {
      if (field.status === "valid") continue;
      const message =
        field.status === "above-maximum"
          ? `Il numero di circoscrizioni per la ${field.taxLabel} supera il massimo ufficiale calcolato (${field.maximum}).`
          : field.status === "invalid"
            ? `Il numero di circoscrizioni per la ${field.taxLabel} deve essere un intero non negativo.`
            : `Indica il numero di circoscrizioni interessate da nuove trascrizioni per la ${field.taxLabel}.`;
      issues.push({
        id: `CALCULATION_${field.kind}_JURISDICTIONS_${field.status.toUpperCase().replace("-", "_")}`,
        level: "blocking",
        fieldId: field.fieldId,
        message,
        sourceId: "SRC-39",
        sourcePointer: `Quadro EF, rigo ${field.row}; controllo SUC13`,
      });
    }
  }
  const hasTestament =
    technicalFieldValue(
      declaration.declaration,
      "/Fornitura/Dichiarazione/Frontespizio/TipoDichiarazione/Devoluzione/DevoluzionePerTestamento",
    ) === "1" ||
    technicalFieldValue(
      declaration.declaration,
      "/Fornitura/Dichiarazione/QuadroEG/Testamento/TestamentoNum",
    ) !== "";
  const allBeneficiariesDisabled =
    entries.length > 0 &&
    entries.every(
      (entry) =>
        String(
          getCanonicalField(declaration.declaration, "quadro-ea.soggetto.disabilita", entry.id)
            ?.value ?? "0",
        ) === "1",
    );
  const hasTrustBeneficiary = entries.some((entry) => {
    const finalBeneficiary = String(
      getCanonicalField(
        declaration.declaration,
        "quadro-ea.soggetto.trust.beneficiario-finale",
        entry.id,
      )?.value ?? "",
    ).trim();
    const relationshipCode = String(
      getCanonicalField(declaration.declaration, "quadro-ea.soggetto.grado-parentela", entry.id)
        ?.value ?? "",
    );
    return finalBeneficiary !== "" || relationshipCode === "35";
  });
  const advanceTrustPayment =
    technicalFieldValue(
      declaration.declaration,
      `${EF_PATH}/SezioneVBis_ImpostaSuccessione/PagamentoAnticipatoTrust`,
    ) === "1";
  let declarationTaxes = calculateDeclarationTaxSummary(allocations, result.totalTaxCents, {
    openingDate: openingDateForCalculation,
    declaredMortgageJurisdictionCount,
    declaredStampDutyJurisdictionCount,
    automaticLandRegistry:
      technicalFieldValue(
        declaration.declaration,
        "/Fornitura/Dichiarazione/Frontespizio/CasiParticolari/CasiParticolari",
      ) !== "1",
    copyRequested:
      technicalFieldValue(
        declaration.declaration,
        "/Fornitura/Dichiarazione/Frontespizio/CasiParticolari/CopiaConforme",
      ) === "1",
    hasTestament,
    presenterCode,
    allBeneficiariesDisabled,
    substituteType,
    paymentTiming,
    mortgageAlreadyPaidCents: centsAt("SezioneI_ImpostaIpotecaria/ImpostaIpotecariaVersata"),
    mortgageCreditCents: centsAt("SezioneI_ImpostaIpotecaria/CreditoImposta"),
    cadastralAlreadyPaidCents: centsAt("SezioneII_ImpostaCatastale/ImpostaCatastaleVersata"),
    cadastralCreditCents: centsAt("SezioneII_ImpostaCatastale/CreditoImposta"),
    successionAlreadyPaidCents: centsAt(
      "SezioneVBis_ImpostaSuccessione/ImpostaCalcolata/ImpostaVersata",
    ),
    successionCreditCents: centsAt(
      "SezioneVBis_ImpostaSuccessione/ImpostaCalcolata/CreditoImposta",
    ),
    penaltiesCents: [
      "ImpostaIpotecaria",
      "ImpostaCatastale",
      "TassaIpotecaria",
      "ImpostaBollo",
      "ImpostaSuccessione",
    ].map((section) => centsAt(`SezioneVI_SanzioniInteressi/${section}/${section}_Sanzioni`)),
    interestCents: [
      "ImpostaIpotecaria",
      "ImpostaCatastale",
      "TassaIpotecaria",
      "ImpostaBollo",
      "ImpostaSuccessione",
    ].map((section) => centsAt(`SezioneVI_SanzioniInteressi/${section}/${section}_Interessi`)),
  });
  const trustAdvanceAllowed = presenterCode === "9" && hasTrustBeneficiary;
  if (advanceTrustPayment && !trustAdvanceAllowed)
    issues.push({
      id: "CALCULATION_ADVANCE_TRUST_PAYMENT_NOT_ALLOWED",
      level: "blocking",
      fieldId: `xsd:${EF_PATH}/SezioneVBis_ImpostaSuccessione/PagamentoAnticipatoTrust`,
      message:
        "Il pagamento anticipato del trust richiede il presentatore previsto e un beneficiario del trust nel Quadro EA.",
      sourceId: "SRC-08",
      sourcePointer: "Quadro EF, rigo EF18-ter",
    });
  if (
    paymentTimingText !== "" &&
    (declarationTaxes.successionTax.payableCents === 0n ||
      (presenterCode === "9" && !advanceTrustPayment))
  )
    issues.push({
      id: "CALCULATION_PAYMENT_TIMING_NOT_ALLOWED",
      level: "blocking",
      fieldId: `xsd:${EF_PATH}/SezioneVBis_ImpostaSuccessione/ImpostaCalcolata/TempisticaPagamento`,
      message: "La tempistica di pagamento non è prevista per questa dichiarazione.",
      sourceId: "SRC-08",
      sourcePointer: "Quadro EF, rigo EF18-ter",
    });
  if (initialPaymentText !== "" && installmentText === "")
    issues.push({
      id: "CALCULATION_INITIAL_PAYMENT_WITHOUT_INSTALLMENTS",
      level: "blocking",
      fieldId: `xsd:${EF_PATH}/SezioneVBis_ImpostaSuccessione/ImpostaCalcolata/Acconto`,
      message: "L’acconto può essere indicato soltanto insieme al pagamento rateale.",
      sourceId: "SRC-08",
      sourcePointer: "Quadro EF, rigo EF18-ter",
    });
  let paymentPlan: SuccessionPaymentPlan | null = null;
  if (declarationTaxes.successionTax.payableCents > 0n) {
    try {
      paymentPlan = buildSuccessionPaymentPlan({
        totalCents: declarationTaxes.successionTax.payableCents,
        openingDate: declaration.declaration.successionOpenedAt ?? "2025-01-01",
        installments: installmentCount,
        initialPaymentCents:
          installmentText === "" ? undefined : (initialPaymentCents ?? undefined),
        presenterCode,
        hasTrustBeneficiary,
        advanceTrustPayment,
        paymentTiming: paymentTimingText === "" ? undefined : paymentTiming,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "PIANO_NON_VALIDO";
      const messages: Record<string, string> = {
        NUMERO_RATE_NON_VALIDO: "Il numero di rate indicato non è ammesso.",
        RATEAZIONE_NON_AMMESSA:
          "Il residuo dopo l’acconto è inferiore a 1.000 euro e non può essere rateizzato.",
        NUMERO_RATE_NON_AMMESSO:
          "Con un residuo non superiore a 20.000 euro sono ammesse al massimo otto rate.",
        ACCONTO_NON_VALIDO:
          "L’acconto deve essere compreso tra il 20% dell’imposta dovuta e l’intero importo.",
        ACCONTO_OBBLIGATORIO: "Indica l’acconto quando scegli il pagamento rateale.",
        PAGAMENTO_ANTICIPATO_TRUST_NON_AMMESSO:
          "Il pagamento anticipato non è ammesso per il trust indicato.",
        TEMPISTICA_TRUST_NON_AMMESSA:
          "La tempistica di pagamento non è prevista senza pagamento anticipato del trust.",
        RATEAZIONE_TRUST_NON_AMMESSA:
          "Il pagamento rateale non è previsto senza pagamento anticipato del trust.",
        TEMPISTICA_TRUST_OBBLIGATORIA:
          "Indica la tempistica quando scegli il pagamento anticipato del trust.",
        TEMPISTICA_OBBLIGATORIA:
          "Indica nel Quadro EF quando sarà versata l’imposta di successione.",
      };
      const fieldId = code.startsWith("TEMPISTICA_")
        ? `xsd:${EF_PATH}/SezioneVBis_ImpostaSuccessione/ImpostaCalcolata/TempisticaPagamento`
        : code === "PAGAMENTO_ANTICIPATO_TRUST_NON_AMMESSO"
          ? `xsd:${EF_PATH}/SezioneVBis_ImpostaSuccessione/PagamentoAnticipatoTrust`
          : `xsd:${EF_PATH}/SezioneVBis_ImpostaSuccessione/ImpostaCalcolata/PagamentoRateale`;
      issues.push({
        id: `CALCULATION_PAYMENT_PLAN_${code}`,
        level: "blocking",
        fieldId,
        message: messages[code] ?? "Il piano di pagamento indicato non è valido.",
        sourceId: "SRC-13",
        sourcePointer: "Pagamento dell’imposta di successione e rateazione",
      });
    }
  }
  declarationTaxes = calculateDeclarationTaxSummary(allocations, result.totalTaxCents, {
    openingDate: openingDateForCalculation,
    declaredMortgageJurisdictionCount,
    declaredStampDutyJurisdictionCount,
    automaticLandRegistry:
      technicalFieldValue(
        declaration.declaration,
        "/Fornitura/Dichiarazione/Frontespizio/CasiParticolari/CasiParticolari",
      ) !== "1",
    copyRequested:
      technicalFieldValue(
        declaration.declaration,
        "/Fornitura/Dichiarazione/Frontespizio/CasiParticolari/CopiaConforme",
      ) === "1",
    hasTestament,
    presenterCode,
    allBeneficiariesDisabled,
    substituteType,
    paymentTiming,
    initialSuccessionPaymentCents: paymentPlan?.initialPaymentCents,
    mortgageAlreadyPaidCents: declarationTaxes.mortgageTax.alreadyPaidCents,
    mortgageCreditCents: declarationTaxes.mortgageTax.creditCents,
    cadastralAlreadyPaidCents: declarationTaxes.cadastralTax.alreadyPaidCents,
    cadastralCreditCents: declarationTaxes.cadastralTax.creditCents,
    successionAlreadyPaidCents: declarationTaxes.successionTax.alreadyPaidCents,
    successionCreditCents: declarationTaxes.successionTax.creditCents,
    penaltiesCents: [declarationTaxes.penaltiesCents],
    interestCents: [declarationTaxes.interestCents],
  });
  declarationTaxes = {
    ...declarationTaxes,
    officialFieldValues: addSnapshotAutomaticOfficialFieldValues(
      declaration.declaration,
      declarationTaxes.officialFieldValues,
    ),
  };
  const compareDeclaredEuro = (
    path: string,
    expectedCents: bigint,
    label: string,
    sourceId: string,
  ) => {
    const entered = technicalFieldValue(declaration.declaration, path);
    if (entered === "") return;
    const enteredCents = wholeEurosToCents(entered);
    if (enteredCents === expectedCents) return;
    issues.push({
      id: `CALCULATION_DECLARED_DIVERGENCE:${path}`,
      level: "blocking",
      fieldId: `xsd:${path}`,
      message: `${label}: il valore indicato non coincide con il calcolo della pratica.`,
      sourceId,
      sourcePointer: path,
    });
  };
  compareDeclaredEuro(
    "/Fornitura/Dichiarazione/QuadroEE/TotaleValoreImmobili",
    declarationTaxes.estate.propertyCents,
    "Totale immobili",
    "SRC-08",
  );
  compareDeclaredEuro(
    "/Fornitura/Dichiarazione/QuadroEE/TotaleAttivo",
    declarationTaxes.estate.totalAssetsCents,
    "Totale attivo",
    "SRC-08",
  );
  compareDeclaredEuro(
    "/Fornitura/Dichiarazione/QuadroEE/TotalePassivo",
    declarationTaxes.estate.totalLiabilitiesCents,
    "Totale passivo",
    "SRC-08",
  );
  compareDeclaredEuro(
    `${EF_PATH}/SezioneI_ImpostaIpotecaria/ImpostaIpotecariaDaVersare`,
    declarationTaxes.mortgageTax.payableCents,
    "Imposta ipotecaria da versare",
    "SRC-08",
  );
  compareDeclaredEuro(
    `${EF_PATH}/SezioneII_ImpostaCatastale/ImpostaCatastaleDaVersare`,
    declarationTaxes.cadastralTax.payableCents,
    "Imposta catastale da versare",
    "SRC-08",
  );
  compareDeclaredEuro(
    `${EF_PATH}/SezioneVBis_ImpostaSuccessione/ImpostaCalcolata/ImpostaDaVersare`,
    declarationTaxes.successionTax.payableCents,
    "Imposta di successione da versare",
    "SRC-08",
  );
  compareDeclaredEuro(
    `${EF_PATH}/TotaleDaVersare`,
    declarationTaxes.totalAtSubmissionCents,
    "Totale da versare",
    "SRC-08",
  );
  const inputJson = serializeBigInts({
    beneficiaries,
    allocations,
    scenarioId: scenario.id,
    calculationContext: {
      successionOpenedAt: declaration.declaration.successionOpenedAt,
      evaluationDate: localTodayIso(),
      catalogStatus,
      issues,
      declarationTaxes,
      paymentPlan,
    },
  });
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
      serializeBigInts({ ...result, declarationTaxes, paymentPlan }),
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
  if (
    !calculation ||
    calculation.status !== "draft" ||
    calculation.issues.length > 0 ||
    getCatalogStatus().status !== "qualified"
  )
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
    occurrenceId?: string | null;
  },
): { revision: number; issues: ValidationIssue[] } {
  return saveCanonicalFields(database, {
    practiceId: input.practiceId,
    declarationId: input.declarationId,
    expectedRevision: input.expectedRevision,
    entityId: input.entityId,
    occurrenceId: input.occurrenceId,
    fields: [{ fieldId: input.fieldId, value: input.value }],
    confirmOfficialRules: true,
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
    occurrenceId?: string | null;
    confirmOfficialRules?: boolean;
  },
): { revision: number; issues: ValidationIssue[] } {
  const record = getDeclaration(database, input.declarationId, input.practiceId);
  if (!record) throw new Error("DECLARATION_NOT_FOUND");
  const entityId = input.entityId ?? null;
  const occurrenceId = input.occurrenceId ?? null;
  const fields = input.fields.filter(
    (field, index, all) =>
      all.findIndex((candidate) => candidate.fieldId === field.fieldId) === index,
  );
  const technicalField = fields.find(
    (field) => getCatalogField(field.fieldId)?.presentation === "technical-only",
  );
  if (technicalField)
    return {
      revision: record.revision,
      issues: [
        {
          id: "TECHNICAL_FIELD_NOT_EDITABLE",
          level: "blocking",
          fieldId: technicalField.fieldId,
          message:
            "Questo dato tecnico viene preparato automaticamente dal documento allegato e non può essere modificato a mano.",
          sourceId: "SRC-08",
          sourcePointer: "Proprietà tecnica degli allegati",
        },
      ],
    };
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
  const requiresOccurrence = fields.some(
    (field) => getCatalogField(field.fieldId)?.entityScope === "occurrence",
  );
  const occurrenceGroups = new Set(
    fields
      .map((field) => getCatalogField(field.fieldId)?.occurrenceGroup)
      .filter((group): group is string => Boolean(group)),
  );
  if (requiresOccurrence && (!occurrenceId || occurrenceGroups.size !== 1)) {
    return {
      revision: record.revision,
      issues: [
        {
          id: "OCCURRENCE_REQUIRED",
          level: "blocking",
          fieldId: fields[0]?.fieldId ?? null,
          occurrenceId,
          message: "Non è stato possibile identificare questa posizione del Quadro.",
          sourceId: "SRC-08",
          sourcePointer: "Struttura ripetibile del Quadro ufficiale",
        },
      ],
    };
  }
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
  const fieldsWithInstructions = fields
    .map((field) => ({ ...field, instructions: listOfficialInstructions(field.fieldId) }))
    .filter((field) => field.instructions.length > 0);
  const officialRulesConfirmed = input.confirmOfficialRules !== false;
  if (fieldsWithInstructions.length > 0 && !officialRulesConfirmed)
    issues.push({
      id: "OFFICIAL_INSTRUCTIONS_NOT_CONFIRMED",
      level: "blocking",
      fieldId: fieldsWithInstructions[0]?.fieldId ?? null,
      entityId,
      occurrenceId,
      message:
        "Conferma di aver verificato le indicazioni ministeriali mostrate per questo blocco.",
      sourceId: fieldsWithInstructions[0]?.instructions[0]?.sourceIds[0] ?? "SRC-07",
      sourcePointer:
        fieldsWithInstructions[0]?.instructions[0]?.sourcePointer ?? "Controlli ministeriali",
    });
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
      String(
        getCanonicalField(
          record.declaration,
          field.fieldId,
          requiresOccurrence ? null : entityId,
          requiresOccurrence ? occurrenceId : null,
        )?.value ?? "",
      ) !== field.value,
  );
  const confirmations = { ...record.declaration.officialRuleConfirmations };
  const now = new Date().toISOString();
  let confirmationsChanged = false;
  if (officialRulesConfirmed) {
    for (const field of fieldsWithInstructions) {
      const key = canonicalFieldKey(
        field.fieldId,
        requiresOccurrence ? null : entityId,
        requiresOccurrence ? occurrenceId : null,
      );
      const nextConfirmation = {
        ruleIds: field.instructions.map((instruction) => instruction.id).sort(),
        valueJson: JSON.stringify(field.value),
        confirmedAt: now,
      };
      const previous = confirmations[key];
      if (
        previous?.valueJson !== nextConfirmation.valueJson ||
        JSON.stringify([...previous.ruleIds].sort()) !== JSON.stringify(nextConfirmation.ruleIds)
      ) {
        confirmations[key] = nextConfirmation;
        confirmationsChanged = true;
      }
    }
  }
  if (changedFields.length === 0 && !confirmationsChanged)
    return { revision: record.revision, issues: [] };
  let declaration = record.declaration;
  for (const field of changedFields) {
    declaration = setCanonicalField(
      declaration,
      field.fieldId,
      field.value,
      field.value === "" ? "missing" : "manually_corrected",
      ["manual-entry"],
      requiresOccurrence ? null : entityId,
      requiresOccurrence ? occurrenceId : null,
    );
    if (field.fieldId === SUCCESSION_OPENING_DATE_FIELD_ID)
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
    officialRuleConfirmations: confirmations,
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
      database
        .prepare(
          `UPDATE declaration_subject_entries
           SET tax_code_snapshot = ?
           WHERE declaration_id = ? AND subject_id = ?`,
        )
        .run(eaTaxCode.value || null, input.declarationId, entry.subjectId);
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
      {
        fieldIds: changedFields.map((field) => field.fieldId),
        entityId,
        occurrenceId,
        revision: nextRevision,
      },
    );
    return nextRevision;
  })();
  synchronizeChecklist(database, input.practiceId, input.declarationId);
  return { revision, issues: [] };
}

function canonicalOccurrenceEntries(
  declaration: DeclarationSnapshot,
  occurrenceGroup: string,
): Array<[string, DeclarationSnapshot["fields"][string]]> {
  return Object.entries(declaration.fields).filter(
    ([, field]) =>
      field.occurrenceId !== null &&
      getCatalogField(field.fieldId)?.occurrenceGroup === occurrenceGroup,
  );
}

export function listCanonicalOccurrenceIds(
  declaration: DeclarationSnapshot,
  occurrenceGroup: string,
): string[] {
  return [
    ...new Set(
      canonicalOccurrenceEntries(declaration, occurrenceGroup).map(
        ([, field]) => field.occurrenceId!,
      ),
    ),
  ];
}

export function reorderCanonicalOccurrences(
  database: Database.Database,
  input: {
    practiceId: string;
    declarationId: string;
    expectedRevision: number;
    occurrenceGroup: string;
    occurrenceIds: string[];
  },
): number {
  const record = getDeclaration(database, input.declarationId, input.practiceId);
  if (!record) throw new Error("DECLARATION_NOT_FOUND");
  if (record.revision !== input.expectedRevision) throw new Error("REVISION_CONFLICT");
  const currentIds = listCanonicalOccurrenceIds(record.declaration, input.occurrenceGroup);
  const requestedIds = [...new Set(input.occurrenceIds)];
  if (
    currentIds.length === 0 ||
    requestedIds.length !== input.occurrenceIds.length ||
    requestedIds.length !== currentIds.length ||
    requestedIds.some((occurrenceId) => !currentIds.includes(occurrenceId))
  )
    throw new Error("OCCURRENCE_ORDER_INVALID");
  if (requestedIds.every((occurrenceId, index) => occurrenceId === currentIds[index]))
    return record.revision;

  const entries = Object.entries(record.declaration.fields);
  const occurrenceEntries = canonicalOccurrenceEntries(record.declaration, input.occurrenceGroup);
  const occurrenceKeys = new Set(occurrenceEntries.map(([key]) => key));
  const entriesByOccurrence = Map.groupBy(occurrenceEntries, ([, field]) => field.occurrenceId!);
  const reorderedEntries = requestedIds.flatMap(
    (occurrenceId) => entriesByOccurrence.get(occurrenceId) ?? [],
  );
  const fields: DeclarationSnapshot["fields"] = {};
  let inserted = false;
  for (const [key, field] of entries) {
    if (occurrenceKeys.has(key)) {
      if (!inserted) {
        for (const [occurrenceKey, occurrenceField] of reorderedEntries)
          fields[occurrenceKey] = occurrenceField;
        inserted = true;
      }
      continue;
    }
    fields[key] = field;
  }
  const nextDeclaration = {
    ...record.declaration,
    fields,
    confirmedDevolutionScenarioId: null,
    latestCalculationRunId: null,
  };
  const revision = database.transaction(() => {
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
      nextDeclaration,
    );
    recordAuditEvent(
      database,
      input.practiceId,
      input.declarationId,
      "occurrences.reordered",
      "Riordinate le posizioni ripetibili della dichiarazione.",
      {
        occurrenceGroup: input.occurrenceGroup,
        occurrenceIds: requestedIds,
        revision: nextRevision,
      },
    );
    return nextRevision;
  })();
  synchronizeChecklist(database, input.practiceId, input.declarationId);
  return revision;
}

export function removeCanonicalOccurrence(
  database: Database.Database,
  input: {
    practiceId: string;
    declarationId: string;
    expectedRevision: number;
    occurrenceGroup: string;
    occurrenceId: string;
  },
): number {
  const record = getDeclaration(database, input.declarationId, input.practiceId);
  if (!record) throw new Error("DECLARATION_NOT_FOUND");
  if (record.revision !== input.expectedRevision) throw new Error("REVISION_CONFLICT");
  const occurrenceEntries = canonicalOccurrenceEntries(
    record.declaration,
    input.occurrenceGroup,
  ).filter(([, field]) => field.occurrenceId === input.occurrenceId);
  if (occurrenceEntries.length === 0) throw new Error("OCCURRENCE_NOT_FOUND");
  const removedKeys = new Set(occurrenceEntries.map(([key]) => key));
  const fields = Object.fromEntries(
    Object.entries(record.declaration.fields).filter(([key]) => !removedKeys.has(key)),
  );
  const officialRuleConfirmations = Object.fromEntries(
    Object.entries(record.declaration.officialRuleConfirmations).filter(
      ([key]) => !removedKeys.has(key),
    ),
  );
  const nextDeclaration = {
    ...record.declaration,
    fields,
    officialRuleConfirmations,
    confirmedDevolutionScenarioId: null,
    latestCalculationRunId: null,
  };
  const revision = database.transaction(() => {
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
      nextDeclaration,
    );
    recordAuditEvent(
      database,
      input.practiceId,
      input.declarationId,
      "occurrence.removed",
      "Rimossa una posizione ripetibile dalla dichiarazione.",
      {
        occurrenceGroup: input.occurrenceGroup,
        occurrenceId: input.occurrenceId,
        fieldIds: occurrenceEntries.map(([, field]) => field.fieldId),
        revision: nextRevision,
      },
    );
    return nextRevision;
  })();
  synchronizeChecklist(database, input.practiceId, input.declarationId);
  return revision;
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

export function listPracticeDeadlines(
  database: Database.Database,
  today = localTodayIso(),
): PracticeDeadlineSummary[] {
  const dayInMilliseconds = 86_400_000;
  const todayTimestamp = new Date(`${today}T00:00:00Z`).valueOf();
  if (Number.isNaN(todayTimestamp)) throw new Error("DATA_NON_VALIDA");

  return listPractices(database)
    .flatMap((practice): PracticeDeadlineSummary[] => {
      const declaration = getDeclaration(database, practice.declarationId, practice.id);
      const openingDate = declaration?.declaration.successionOpenedAt;
      if (!declaration || !openingDate) return [];

      const alternativeStartText = technicalFieldValue(
        declaration.declaration,
        "/Fornitura/Dichiarazione/Frontespizio/Presentatore/DecorrenzaTerminePresentazione",
      );
      const alternativeStart = officialDateToIso(alternativeStartText);
      const presenterRole = technicalFieldValue(
        declaration.declaration,
        "/Fornitura/Dichiarazione/Frontespizio/Presentatore/CodiceCarica",
      );
      const hasAlternativeEvent =
        declaration.declaration.declarationKind !== "first" ||
        ["3", "4", "5", "6", "7", "8", "9"].includes(presenterRole) ||
        technicalFieldValue(
          declaration.declaration,
          "/Fornitura/Dichiarazione/Frontespizio/Beneficiari/AccettazioneConBeneficioInventario",
        ) === "1" ||
        Object.values(declaration.declaration.fields).some(
          (field) =>
            (field.fieldId === "quadro-ea.soggetto.rinuncia" && String(field.value) === "1") ||
            (field.fieldId ===
              "xsd:/Fornitura/Dichiarazione/QuadroEH/PrimoModulo/SezioneI_DichSost/DatiDefunto/MortePresunta/DataDeposito" &&
              field.value !== "" &&
              field.value !== null),
        );

      if (hasAlternativeEvent && !alternativeStart)
        return [
          {
            practiceId: practice.id,
            practiceTitle: practice.title,
            label: "Presentazione della dichiarazione",
            dueDate: null,
            timing: "unqualified",
            timingLabel:
              "Decorrenza particolare: indica la data da cui parte il termine di dodici mesi",
            sourceId: "SRC-05",
          },
        ];

      let dueDate: string;
      try {
        dueDate = ordinaryDeclarationDeadline(alternativeStart ?? openingDate);
      } catch {
        return [];
      }
      const days = Math.round(
        (new Date(`${dueDate}T00:00:00Z`).valueOf() - todayTimestamp) / dayInMilliseconds,
      );
      const absoluteDays = Math.abs(days);
      const timing = days < 0 ? "overdue" : days === 0 ? "today" : days <= 30 ? "soon" : "upcoming";
      const timingLabel =
        days < 0
          ? `Scaduta da ${absoluteDays} ${absoluteDays === 1 ? "giorno" : "giorni"}`
          : days === 0
            ? "Scade oggi"
            : `Scade tra ${days} ${days === 1 ? "giorno" : "giorni"}`;
      return [
        {
          practiceId: practice.id,
          practiceTitle: practice.title,
          label: "Presentazione della dichiarazione",
          dueDate,
          timing,
          timingLabel,
          sourceId: "SRC-05",
        },
      ];
    })
    .sort((left, right) => {
      if (left.dueDate === null) return right.dueDate === null ? 0 : 1;
      if (right.dueDate === null) return -1;
      return left.dueDate.localeCompare(right.dueDate);
    });
}

type QuadroField = ReturnType<typeof listQuadroFields>[number];

function parentTechnicalPath(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

function isTechnicalDescendant(path: string, ancestor: string): boolean {
  return path.startsWith(`${ancestor}/`);
}

function successionOpeningDateDivergenceIssue(
  declaration: DeclarationSnapshot,
): ValidationIssue | null {
  const frontespizioDate = Object.values(declaration.fields).find(
    (field) => field.fieldId === SUCCESSION_OPENING_DATE_FIELD_ID,
  )?.value;
  const substituteDate = getCanonicalField(
    declaration,
    SUBSTITUTE_SUCCESSION_OPENING_DATE_FIELD_ID,
  )?.value;
  if (
    frontespizioDate === null ||
    frontespizioDate === undefined ||
    String(frontespizioDate) === "" ||
    substituteDate === null ||
    substituteDate === undefined ||
    String(substituteDate) === "" ||
    String(frontespizioDate) === String(substituteDate)
  )
    return null;
  return {
    id: "SUCCESSION_OPENING_DATE_DIVERGENCE",
    level: "blocking",
    fieldId: SUBSTITUTE_SUCCESSION_OPENING_DATE_FIELD_ID,
    message:
      "La data del decesso ripetuta nella dichiarazione sostitutiva deve coincidere con quella del Frontespizio.",
    sourceId: "SRC-08",
    sourcePointer: "Frontespizio e Quadro EH — data del decesso",
  };
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
  type ActiveContext = {
    quadro: QuadroId;
    entityId: string | null;
    occurrenceId: string | null;
    occurrenceGroup: string | null;
    scope: "standard" | "declaration" | "occurrence";
  };
  const active: ActiveContext[] = [
    {
      quadro: "Frontespizio",
      entityId: null,
      occurrenceId: null,
      occurrenceGroup: null,
      scope: "standard",
    },
    ...subjects.map((subject): ActiveContext => ({
      quadro: "EA",
      entityId: subject.id,
      occurrenceId: null,
      occurrenceGroup: null,
      scope: "standard",
    })),
  ];
  for (const asset of assets) {
    if (!asset.quadro) continue;
    active.push({
      quadro: asset.quadro,
      entityId: asset.id,
      occurrenceId: null,
      occurrenceGroup: null,
      scope: "standard",
    });
  }
  const entityQuadri = new Set<QuadroId>([
    "Frontespizio",
    "EA",
    "EB",
    "EC",
    "ED",
    "EL",
    "EM",
    "EN",
    "EO",
    "EP",
    "EQ",
    "ER",
  ]);
  const staticQuadri = new Set<QuadroId>(QUADRI.filter((quadro) => !entityQuadri.has(quadro)));
  const activeKeys = new Set(active.map((context) => JSON.stringify(context)));
  const addActiveContext = (context: ActiveContext): void => {
    const key = JSON.stringify(context);
    if (activeKeys.has(key)) return;
    activeKeys.add(key);
    active.push(context);
  };
  for (const storedField of Object.values(declaration.fields)) {
    if (
      storedField.value === null ||
      storedField.value === undefined ||
      String(storedField.value) === ""
    )
      continue;
    const catalogField = getCatalogField(storedField.fieldId);
    const quadro = catalogField?.quadro as QuadroId | undefined;
    if (!quadro || !staticQuadri.has(quadro)) continue;
    if (catalogField?.entityScope === "occurrence") {
      const occurrenceGroup = catalogField.occurrenceGroup ?? null;
      if (!storedField.occurrenceId || !occurrenceGroup) continue;
      addActiveContext({
        quadro,
        entityId: null,
        occurrenceId: storedField.occurrenceId,
        occurrenceGroup,
        scope: "occurrence",
      });
      continue;
    }
    addActiveContext({
      quadro,
      entityId: null,
      occurrenceId: null,
      occurrenceGroup: null,
      scope: "declaration",
    });
  }
  const occurrencePositions = new Map<string, number>();
  const occurrenceCounts = new Map<string, number>();
  for (const context of active.filter((candidate) => candidate.scope === "occurrence")) {
    const group = `${context.quadro}:${context.occurrenceGroup}`;
    const position = (occurrenceCounts.get(group) ?? 0) + 1;
    occurrenceCounts.set(group, position);
    occurrencePositions.set(`${group}:${context.occurrenceId}`, position);
  }
  for (const context of active) {
    const fields = listQuadroFields(context.quadro).filter(
      (field) =>
        field.entryMode !== "derived" &&
        (field.appliesToDeclarationKinds.length === 0 ||
          field.appliesToDeclarationKinds.includes(declaration.declarationKind)) &&
        (context.scope === "standard" ||
          (context.scope === "declaration" && field.entityScope === "declaration") ||
          (context.scope === "occurrence" &&
            field.entityScope === "occurrence" &&
            field.occurrenceGroup === context.occurrenceGroup)),
    );
    const rootPath =
      context.scope === "occurrence"
        ? context.occurrenceGroup!
        : getQuadroActivationRootPath(context.quadro);
    const technicalElements = listQuadroTechnicalElements(context.quadro).filter(
      (element) =>
        context.scope !== "occurrence" ||
        element.path === rootPath ||
        isTechnicalDescendant(element.path, rootPath),
    );
    const fieldsByPath = new Map(fields.map((field) => [field.path, field]));
    {
      const contextEntityId = context.entityId;
      const contextIdentity = context.occurrenceId ?? contextEntityId ?? "declaration";
      const occurrencePosition =
        context.scope === "occurrence"
          ? occurrencePositions.get(
              `${context.quadro}:${context.occurrenceGroup}:${context.occurrenceId}`,
            )
          : undefined;
      const declarationLocation =
        occurrencePosition !== undefined
          ? `nella posizione ${occurrencePosition} del Quadro ${context.quadro}`
          : `nel ${context.quadro === "Frontespizio" ? "Frontespizio" : `Quadro ${context.quadro}`}`;
      const entityIdFor = (field: QuadroField): string | null =>
        field.entityScope === "decedent" ? (decedent?.id ?? null) : contextEntityId;
      const hasValue = (field: QuadroField): boolean => {
        const value = getCanonicalField(
          declaration,
          field.canonicalId,
          entityIdFor(field),
          field.entityScope === "occurrence" ? context.occurrenceId : null,
        )?.value;
        return value !== null && value !== undefined && String(value) !== "";
      };
      const activeContainers = new Set<string>([rootPath]);
      for (const field of fields.filter(
        (candidate) =>
          hasValue(candidate) ||
          (candidate.minOccurs > 0 && candidate.appliesToDeclarationKinds.length > 0),
      )) {
        let path = parentTechnicalPath(field.path);
        while (path.length >= rootPath.length) {
          activeContainers.add(path);
          if (path === rootPath) break;
          path = parentTechnicalPath(path);
        }
      }
      let activated = true;
      while (activated) {
        activated = false;
        for (const element of technicalElements) {
          if (
            element.kind !== "container" ||
            element.path === rootPath ||
            element.choiceGroup !== null ||
            activeContainers.has(element.path) ||
            !activeContainers.has(parentTechnicalPath(element.path))
          )
            continue;
          if (element.minOccurs === 0) continue;
          activeContainers.add(element.path);
          activated = true;
        }
      }
      const choices = new Map<string, TechnicalElement[]>();
      for (const element of technicalElements) {
        if (!element.choiceGroup) continue;
        if (
          (element.kind === "field" && !fieldsByPath.has(element.path)) ||
          (element.kind === "container" &&
            !fields.some((field) => isTechnicalDescendant(field.path, element.path)))
        )
          continue;
        const members = choices.get(element.choiceGroup) ?? [];
        members.push(element);
        choices.set(element.choiceGroup, members);
      }
      for (const [choiceGroup, members] of choices) {
        const parentPath = parentTechnicalPath(members[0]?.path ?? "");
        const selected = members.filter((member) => {
          if (member.kind === "field") {
            const field = fieldsByPath.get(member.path);
            return field ? hasValue(field) : false;
          }
          return fields.some(
            (field) => isTechnicalDescendant(field.path, member.path) && hasValue(field),
          );
        });
        const choiceIsActive = activeContainers.has(parentPath) || selected.length > 0;
        if (!choiceIsActive) continue;
        const firstField =
          members
            .map((member) =>
              member.kind === "field"
                ? fieldsByPath.get(member.path)
                : fields.find((field) => isTechnicalDescendant(field.path, member.path)),
            )
            .find(Boolean) ?? null;
        if (selected.length === 0 && members.some((member) => member.minOccurs > 0))
          issues.push({
            id: `REQUIRED_CHOICE_MISSING:${choiceGroup}:${contextIdentity}`,
            level: "blocking",
            fieldId: firstField?.canonicalId ?? null,
            entityId: contextEntityId,
            message: contextEntityId
              ? `Scegli una delle alternative previste per ${entityNames.get(contextEntityId) ?? "la posizione interessata"}.`
              : `Scegli una delle alternative previste ${declarationLocation}.`,
            sourceId: firstField?.sourceId ?? members[0]!.sourceId,
            sourcePointer: firstField?.sourcePointer ?? members[0]!.sourcePointer,
          });
        if (selected.length > 1)
          issues.push({
            id: `CHOICE_EXCLUSIVITY_VIOLATION:${choiceGroup}:${contextIdentity}`,
            level: "blocking",
            fieldId: firstField?.canonicalId ?? null,
            entityId: contextEntityId,
            message: contextEntityId
              ? `Mantieni una sola alternativa per ${entityNames.get(contextEntityId) ?? "la posizione interessata"}.`
              : `Mantieni una sola alternativa ${declarationLocation}.`,
            sourceId: firstField?.sourceId ?? members[0]!.sourceId,
            sourcePointer: firstField?.sourcePointer ?? members[0]!.sourcePointer,
          });
      }
      for (const field of fields) {
        if (
          field.choiceGroup !== null ||
          !activeContainers.has(parentTechnicalPath(field.path)) ||
          field.minOccurs === 0 ||
          hasValue(field)
        )
          continue;
        const entityId = entityIdFor(field);
        issues.push({
          id: `REQUIRED_FIELD_MISSING:${field.canonicalId}:${contextIdentity}`,
          level: "blocking",
          fieldId: field.canonicalId,
          entityId,
          message: entityId
            ? `Completa “${field.label}” per ${entityNames.get(entityId) ?? "la posizione interessata"}.`
            : `Completa “${field.label}” ${declarationLocation}.`,
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
  qualification: {
    sourceBundleId: string;
    catalogVersion: string;
    calculationRulesVersion: string;
    temporalRulesVersion: string;
    validatorVersion: string;
    quadriPresent: string[];
    officialControl: {
      name: string;
      version: string;
      status: string;
      blockingDiagnostics: number;
    };
    attachments: {
      files: number;
      totalBytes: number;
      formats: string[];
      motivatedExceptions: number;
    };
  };
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
  const openingDateIssue = successionOpeningDateDivergenceIssue(declaration);
  if (openingDateIssue) issues.push(openingDateIssue);
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
  const officialAttachments = listOfficialAttachments(database, practiceId);
  const preparedDocumentIds = new Set(
    officialAttachments.map((attachment) => attachment.documentId),
  );
  const unpreparedAttachments = checklist.filter(
    (item) =>
      item.requirementKind === "attachment" &&
      item.status === "available" &&
      (!item.documentId || !preparedDocumentIds.has(item.documentId)),
  );
  if (unpreparedAttachments.length > 0)
    issues.push({
      id: "OFFICIAL_ATTACHMENTS_NOT_PREPARED",
      level: "blocking",
      fieldId: null,
      message:
        "Almeno un documento da allegare non è ancora stato trasformato e controllato come PDF/A-1b o TIFF.",
      sourceId: "SRC-07/SRC-08/SRC-09",
      sourcePointer: "allegati PDF/A-1b o TIFF, 5 MB per file e 40 MB complessivi",
    });
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
  const quadriPresent = [
    ...new Set(
      Object.values(declaration.fields)
        .filter(
          (field) =>
            field.state !== "not_applicable" &&
            field.value !== null &&
            field.value !== undefined &&
            field.value !== "",
        )
        .map((field) => getCatalogField(field.fieldId)?.quadro)
        .filter((quadro): quadro is string => Boolean(quadro)),
    ),
  ].sort((left, right) => QUADRI.indexOf(left as QuadroId) - QUADRI.indexOf(right as QuadroId));
  const qualification = {
    sourceBundleId: declaration.officialSourceBundleId,
    catalogVersion: declaration.catalogVersion,
    calculationRulesVersion: SUCCESSION_TAX_RULESET_VERSION,
    temporalRulesVersion: TEMPORAL_RULESET_VERSION,
    validatorVersion: declaration.validatorVersion,
    quadriPresent,
    officialControl: {
      name: controlQualification.control.name,
      version: controlQualification.control.version,
      status: controlQualification.status,
      blockingDiagnostics: controlQualification.result.blockingDiagnostics.length,
    },
    attachments: {
      files: officialAttachments.length,
      totalBytes: officialAttachments.reduce((sum, attachment) => sum + attachment.byteSize, 0),
      formats: [...new Set(officialAttachments.map((attachment) => attachment.format))].sort(),
      motivatedExceptions: checklist.filter((item) => item.status === "overridden").length,
    },
  };
  const canonical = JSON.stringify({
    declaration,
    issues: uniqueIssues,
    checklist,
    preparedAttachments: [...preparedDocumentIds].sort(),
    qualification,
  });
  return {
    declaration: parseDeclaration(declaration),
    issues: uniqueIssues,
    checklist,
    qualification,
    ready: !uniqueIssues.some((issue) => issue.level === "blocking"),
    digest: createHash("sha256").update(canonical).digest("hex"),
  };
}
