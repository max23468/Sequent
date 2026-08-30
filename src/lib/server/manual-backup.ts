import { open, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { createBaseBackup, readBaseBackupMetadata, verifyBaseBackup } from "./backup.ts";
import { DEPLOYMENT_MAINTENANCE_MARKER } from "./deployment-maintenance.ts";

export interface ManualBackupStatus {
  path: string;
  createdAt: string;
  ageDays: number;
  reminder: "current" | "due" | "overdue";
}

export async function createManualBackup(
  database: Database.Database,
  dataDirectory: string,
  options: { runningJobTimeoutMs?: number; pollMs?: number } = {},
): Promise<string> {
  const markerPath = join(dataDirectory, DEPLOYMENT_MAINTENANCE_MARKER);
  let marker;
  try {
    marker = await open(markerPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("MAINTENANCE_ACTIVE");
    throw error;
  }
  try {
    const deadline = Date.now() + (options.runningJobTimeoutMs ?? 30_000);
    while (true) {
      const active = database
        .prepare("SELECT count(*) AS count FROM jobs WHERE status = 'running'")
        .get() as { count: number };
      if (active.count === 0) break;
      if (Date.now() >= deadline) throw new Error("BACKUP_JOB_TIMEOUT");
      await new Promise((resolveWait) => setTimeout(resolveWait, options.pollMs ?? 250));
    }
    const path = await createBaseBackup(database, dataDirectory, join(dataDirectory, "backups"));
    await verifyBaseBackup(path);
    return path;
  } finally {
    await marker.close();
    await rm(markerPath, { force: true });
  }
}

export async function getLatestManualBackup(
  dataDirectory: string,
  now = new Date(),
): Promise<ManualBackupStatus | null> {
  const directory = join(dataDirectory, "backups");
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const candidates = [] as Array<{ path: string; createdAt: string }>;
  for (const name of names) {
    if (!name.startsWith("sequent-backup-") || name.startsWith(".backup-")) continue;
    const path = join(directory, name);
    try {
      if (!(await stat(path)).isFile() || !name.endsWith(".zip")) continue;
      const manifest = await readBaseBackupMetadata(path);
      if (manifest.format !== "sequent-base-backup" || !manifest.createdAt) continue;
      candidates.push({ path, createdAt: manifest.createdAt });
    } catch {
      // Un backup incompleto o estraneo non diventa lo stato operativo corrente.
    }
  }
  const latest = candidates.sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (!latest) return null;
  const ageDays = Math.max(
    0,
    Math.floor((now.getTime() - new Date(latest.createdAt).getTime()) / (24 * 60 * 60 * 1_000)),
  );
  return {
    ...latest,
    ageDays,
    reminder: ageDays >= 14 ? "overdue" : ageDays >= 7 ? "due" : "current",
  };
}
