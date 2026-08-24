import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export interface PracticeSummary {
  id: string;
  title: string;
  status: "active" | "archived" | "trashed";
  revision: number;
  updatedAt: string;
}

export function createPractice(database: Database.Database, title: string): PracticeSummary {
  const id = randomUUID();
  const now = new Date().toISOString();
  const declaration = { schemaVersion: 1, fields: {}, sources: {}, decisions: [] };
  database
    .prepare(
      `INSERT INTO practices(id, title, status, revision, declaration_json, created_at, updated_at)
       VALUES (?, ?, 'active', 1, ?, ?, ?)`,
    )
    .run(id, title, JSON.stringify(declaration), now, now);
  return { id, title, status: "active", revision: 1, updatedAt: now };
}

export function listPractices(database: Database.Database): PracticeSummary[] {
  const rows = database
    .prepare(
      `SELECT id, title, status, revision, updated_at
       FROM practices WHERE status = 'active' ORDER BY updated_at DESC`,
    )
    .all() as Array<{
    id: string;
    title: string;
    status: PracticeSummary["status"];
    revision: number;
    updated_at: string;
  }>;
  return rows.map((row) => ({ ...row, updatedAt: row.updated_at }));
}

export function saveDeclaration(
  database: Database.Database,
  practiceId: string,
  expectedRevision: number,
  declaration: unknown,
): number {
  const now = new Date().toISOString();
  const result = database
    .prepare(
      `UPDATE practices
       SET declaration_json = ?, revision = revision + 1, updated_at = ?
       WHERE id = ? AND revision = ?`,
    )
    .run(JSON.stringify(declaration), now, practiceId, expectedRevision);
  if (result.changes !== 1) throw new Error("REVISION_CONFLICT");
  return expectedRevision + 1;
}
