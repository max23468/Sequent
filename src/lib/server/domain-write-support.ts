import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getDeclaration, saveDeclaration } from "./practices.ts";

export function parseRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function serializeBigInts(value: unknown): string {
  return JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item));
}

export function recordAuditEvent(
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

export function supersedeDerivedResults(
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

export function invalidateDerivedResultsIfPresent(
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
