import type Database from "better-sqlite3";
import { SUCCESSION_TAX_RULESET_VERSION } from "../../domain/calculation-types.ts";
import { getDeclaration } from "./practices.ts";
import { listSharedAssets } from "./domain-assets.ts";
import { listDevolutionScenarios } from "./domain-devolution.ts";
import type { ChecklistItem } from "./domain-model.ts";
import { recordAuditEvent } from "./domain-write-support.ts";
import { successioniOnLineEgBucketForChecklistItem } from "../../domain/successionionline-eg.ts";

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
    officialAttachmentBucket: successioniOnLineEgBucketForChecklistItem(String(row.id)),
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
      requirementKind: "attachment",
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
      id: "ipocatastal-relief-proof",
      requirementKind: "attachment",
      importance: "blocking",
      label: "Richiesta e documenti per agevolazioni ipocatastali diverse dalla prima casa",
      applicable: ["C", "D", "E"].some((code) => reliefCodes.has(code)),
      sourceRefs: ["SRC-05#quali-documenti-occorrono", "SRC-01#quadro-eg"],
    },
    {
      id: "succession-reduction-proof",
      requirementKind: "attachment",
      importance: "blocking",
      label: "Richiesta e documenti per riduzioni dell’imposta di successione",
      applicable:
        ["A", "L", "Q", "1", "2", "3", "4", "5"].some((code) => reliefCodes.has(code)) ||
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
