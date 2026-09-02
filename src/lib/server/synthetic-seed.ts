import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { createSharedAsset } from "./domain-assets.ts";
import { runSuccessionCalculation } from "./domain-calculations.ts";
import { confirmDevolutionScenario, saveDevolutionScenario } from "./domain-devolution.ts";
import { saveCanonicalFields } from "./domain-fields.ts";
import { createSharedSubject } from "./domain-subjects.ts";
import { createPractice } from "./practices.ts";

const SEED_EVENT = "installation.synthetic_demo.v1";
const BUILDING_VALUE_FIELD = "xsd:/Fornitura/Dichiarazione/QuadroEC/Modulo/Fabbricati/Valore";

export interface SyntheticSeedResult {
  practiceId: string;
  created: boolean;
}

function findSyntheticPractice(database: Database.Database): string | null {
  const row = database
    .prepare(
      `SELECT practice_id FROM domain_audit_events
       WHERE event_type = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(SEED_EVENT) as { practice_id: string } | undefined;
  return row?.practice_id ?? null;
}

function saveFields(
  database: Database.Database,
  input: Parameters<typeof saveCanonicalFields>[1],
): number {
  const result = saveCanonicalFields(database, input);
  if (result.issues.length > 0)
    throw new Error(`SYNTHETIC_SEED_FIELD_INVALID:${result.issues[0]?.id ?? "UNKNOWN"}`);
  return result.revision;
}

export function ensureSyntheticPractice(database: Database.Database): SyntheticSeedResult {
  const existing = findSyntheticPractice(database);
  if (existing) return { practiceId: existing, created: false };

  return database
    .transaction(() => {
      const concurrent = findSyntheticPractice(database);
      if (concurrent) return { practiceId: concurrent, created: false };
      const practice = createPractice(database, "ESEMPIO SINTETICO — Successione dimostrativa");
      const decedent = createSharedSubject(database, practice.id, {
        role: "decedent",
        displayName: "Defunto sintetico",
        taxCode: "VRDLGI80A01H501U",
      });
      const beneficiary = createSharedSubject(database, practice.id, {
        role: "beneficiary",
        displayName: "Beneficiario sintetico",
        taxCode: "RSSMRA80A01H501U",
      });
      const asset = createSharedAsset(database, practice.id, {
        kind: "building",
        displayName: "Immobile sintetico",
        valueCents: 20_000_000n,
      });
      let revision = saveFields(database, {
        practiceId: practice.id,
        declarationId: practice.declarationId,
        expectedRevision: 1,
        entityId: beneficiary.id,
        fields: [
          { fieldId: "quadro-ea.soggetto.tipo", value: "1" },
          { fieldId: "quadro-ea.soggetto.grado-parentela", value: "10" },
        ],
      });
      revision = saveFields(database, {
        practiceId: practice.id,
        declarationId: practice.declarationId,
        expectedRevision: revision,
        fields: [{ fieldId: "frontespizio.devoluzione.per-legge", value: "1" }],
      });
      revision = saveFields(database, {
        practiceId: practice.id,
        declarationId: practice.declarationId,
        expectedRevision: revision,
        entityId: decedent.id,
        fields: [
          { fieldId: "frontespizio.defunto.stato-civile", value: "3" },
          { fieldId: "frontespizio.defunto.data-decesso", value: "01012025" },
        ],
      });
      revision = saveFields(database, {
        practiceId: practice.id,
        declarationId: practice.declarationId,
        expectedRevision: revision,
        entityId: asset.id,
        fields: [{ fieldId: BUILDING_VALUE_FIELD, value: "200000" }],
      });
      const scenario = saveDevolutionScenario(database, {
        practiceId: practice.id,
        declarationId: practice.declarationId,
        expectedRevision: revision,
        shares: [
          {
            assetId: asset.id,
            beneficiaryId: beneficiary.id,
            numerator: 1n,
            denominator: 1n,
            rightCode: "1",
          },
        ],
      });
      if (scenario.issues.length > 0) throw new Error("SYNTHETIC_SEED_DEVOLUTION_INVALID");
      confirmDevolutionScenario(database, {
        practiceId: practice.id,
        declarationId: practice.declarationId,
        scenarioId: scenario.id,
        expectedRevision: revision,
      });
      const calculation = runSuccessionCalculation(database, {
        practiceId: practice.id,
        declarationId: practice.declarationId,
      });
      database
        .prepare(
          `INSERT INTO domain_audit_events(
           id, practice_id, declaration_id, event_type, summary, payload_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          practice.id,
          practice.declarationId,
          SEED_EVENT,
          "Creata la pratica dimostrativa sintetica dell’installazione.",
          JSON.stringify({ calculationId: calculation.id, synthetic: true }),
          new Date().toISOString(),
        );
      return { practiceId: practice.id, created: true };
    })
    .immediate();
}

export function removeSyntheticPractice(database: Database.Database): boolean {
  const practiceId = findSyntheticPractice(database);
  if (!practiceId) return false;
  return database
    .transaction(() => {
      const result = database.prepare("DELETE FROM practices WHERE id = ?").run(practiceId);
      return result.changes === 1;
    })
    .immediate();
}
