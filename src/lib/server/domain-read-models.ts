import type Database from "better-sqlite3";
import { ordinaryDeclarationDeadline } from "../../domain/temporal-rules.ts";
import { localTodayIso, officialDateToIso, technicalFieldValue } from "./domain-values.ts";
import { getDeclaration, listPractices } from "./practices.ts";

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
