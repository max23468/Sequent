import type Database from "better-sqlite3";

export interface SearchResult {
  kind: "practice" | "document" | "subject" | "asset";
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
  const queryParts = query.normalize("NFC").match(/[\p{L}\p{N}]+/gu);
  if (!queryParts) {
    const foldedQuery = query.normalize("NFC").toLocaleLowerCase("it-IT");
    return (
      database
        .prepare(
          `SELECT workspace_search.kind, workspace_search.entity_id AS id,
                  workspace_search.practice_id, workspace_search.label, workspace_search.context,
                  coalesce(practices.updated_at, '') AS updated_at
           FROM workspace_search
           JOIN practices ON practices.id = workspace_search.practice_id
           WHERE practices.status = 'active'
           ORDER BY practices.updated_at DESC`,
        )
        .all() as Array<Record<string, unknown>>
    )
      .map((row) => ({
        kind: String(row.kind) as SearchResult["kind"],
        id: String(row.id),
        practiceId: String(row.practice_id),
        label: String(row.label),
        context: String(row.context),
        updatedAt: String(row.updated_at),
      }))
      .filter((item) =>
        item.label.normalize("NFC").toLocaleLowerCase("it-IT").includes(foldedQuery),
      )
      .slice(0, Math.max(0, limit));
  }
  const tokens = queryParts.map((token) => `"${token.replaceAll('"', '""')}"*`).join(" AND ");
  return database
    .prepare(
      `SELECT workspace_search.kind, workspace_search.entity_id AS id,
              workspace_search.practice_id, workspace_search.label, workspace_search.context,
              coalesce(practices.updated_at, '') AS updated_at,
              bm25(workspace_search, 8.0, 1.0) AS rank
       FROM workspace_search
       JOIN practices ON practices.id = workspace_search.practice_id
       WHERE workspace_search MATCH ? AND practices.status = 'active'
       ORDER BY rank ASC, practices.updated_at DESC
       LIMIT ?`,
    )
    .all(tokens, Math.max(0, limit))
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
        context:
          item.kind === "subject"
            ? `Soggetto${item.context ? ` · ${item.context}` : ""}`
            : item.kind === "asset"
              ? "Bene o passività"
              : item.context,
        updatedAt: item.updated_at,
      };
    }) as SearchResult[];
}
