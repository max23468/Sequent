import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, openDatabase } from "../../src/lib/server/database.ts";
import { DEPLOYMENT_MAINTENANCE_MARKER } from "../../src/lib/server/deployment-maintenance.ts";
import { verifyBaseBackup } from "../../src/lib/server/backup.ts";
import { createManualBackup, getLatestManualBackup } from "../../src/lib/server/manual-backup.ts";
import { createPractice } from "../../src/lib/server/practices.ts";
import { addOfficialArtifact } from "../../src/lib/server/official-flow.ts";
import { enqueueJob } from "../../src/lib/server/jobs.ts";
import { zipSync } from "fflate";
import { Open } from "unzipper-esm";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    closeDatabase(directory);
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("backup manuale in manutenzione", () => {
  it("crea e verifica la copia, poi rimuove sempre il marker", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-manual-backup-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const practice = createPractice(database, "Pratica nel backup manuale");
    const artifact = await addOfficialArtifact(database, {
      practiceId: practice.id,
      declarationId: practice.declarationId,
      kind: "receipt-first",
      file: new File(["ricevuta nel backup"], "ricevuta.txt", { type: "text/plain" }),
      dataDirectory: directory,
    });
    enqueueJob(database, "foundation.test", { suspendedDuringBackup: true });

    const backup = await createManualBackup(database, directory);
    expect(existsSync(backup)).toBe(true);
    expect(existsSync(join(directory, DEPLOYMENT_MAINTENANCE_MARKER))).toBe(false);
    expect(await getLatestManualBackup(directory)).toMatchObject({
      path: backup,
      ageDays: 0,
      reminder: "current",
    });

    const archive = await Open.file(backup);
    const entries = Object.fromEntries(
      await Promise.all(
        archive.files
          .filter((entry) => entry.type === "File")
          .map(async (entry) => [entry.path, new Uint8Array(await entry.buffer())] as const),
      ),
    );
    entries[artifact.blobPath] = Buffer.from("contenuto corrotto");
    const manifest = JSON.parse(Buffer.from(entries["manifest.json"]!).toString("utf8")) as {
      files: Array<{ path: string; bytes: number; sha256: string }>;
    };
    const changed = Buffer.from("contenuto corrotto");
    const entry = manifest.files.find((candidate) => candidate.path === artifact.blobPath)!;
    entry.bytes = changed.byteLength;
    entry.sha256 = createHash("sha256").update(changed).digest("hex");
    entries["manifest.json"] = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    writeFileSync(backup, zipSync(entries));
    await expect(verifyBaseBackup(backup)).rejects.toThrow("BACKUP_BLOB_MISMATCH");
  });

  it("abbandona in sicurezza se il job in corso non termina nella finestra prevista", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-manual-backup-running-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const job = enqueueJob(database, "foundation.test", { runningDuringBackup: true });
    database.prepare("UPDATE jobs SET status = 'running' WHERE id = ?").run(job.id);

    await expect(
      createManualBackup(database, directory, { runningJobTimeoutMs: 0 }),
    ).rejects.toThrow("BACKUP_JOB_TIMEOUT");
    expect(existsSync(join(directory, DEPLOYMENT_MAINTENANCE_MARKER))).toBe(false);
  });
});
