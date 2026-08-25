import type Database from "better-sqlite3";

export interface SearchResult {
  kind: "practice" | "document";
  id: string;
  practiceId: string;
  label: string;
  context: string;
  updatedAt: string;
}

export function searchWorkspace(
  database: Database.Database,
  rawQuery: string,
  limit = 20,
): SearchResult[] {
  const query = rawQuery.trim().slice(0, 120);
  if (!query) return [];
  const foldedQuery = query.normalize("NFC").toLocaleLowerCase("it-IT");
  return database
    .prepare(
      `SELECT kind, id, practice_id, label, context, updated_at
       FROM (
         SELECT 'practice' AS kind, id, id AS practice_id, title AS label,
                'Pratica' AS context, updated_at
         FROM practices
         WHERE status = 'active'
         UNION ALL
         SELECT 'document' AS kind, documents.id, documents.practice_id,
                documents.original_name AS label, practices.title AS context,
                documents.created_at AS updated_at
         FROM documents
         JOIN practices ON practices.id = documents.practice_id
         WHERE practices.status = 'active'
       )
       ORDER BY updated_at DESC`,
    )
    .all()
    .map((row) => {
      const item = row as {
        kind: SearchResult["kind"];
        id: string;
        practice_id: string;
        label: string;
        context: string;
        updated_at: string;
      };
      return {
        kind: item.kind,
        id: item.id,
        practiceId: item.practice_id,
        label: item.label,
        context: item.context,
        updatedAt: item.updated_at,
      };
    })
    .filter((item) => item.label.normalize("NFC").toLocaleLowerCase("it-IT").includes(foldedQuery))
    .slice(0, Math.max(0, limit));
}
