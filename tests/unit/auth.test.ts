import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authenticate, createOwner } from "../../src/lib/server/auth.ts";
import { closeDatabase, openDatabase } from "../../src/lib/server/database.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    closeDatabase(directory);
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("difesa del login", () => {
  it("contabilizza atomicamente i tentativi simultanei della stessa origine", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-auth-concurrent-"));
    directories.push(directory);
    const database = openDatabase(directory);
    await createOwner(database, "FondazioneM2Sicura2026");
    const start = new Date("2026-08-24T10:00:00.000Z");

    await Promise.all(
      Array.from({ length: 5 }, () =>
        authenticate(database, "errata", "client-concorrente", start),
      ),
    );

    const attempt = database
      .prepare("SELECT failed_count, blocked_until FROM login_attempts")
      .get() as { failed_count: number; blocked_until: string };
    expect(attempt).toEqual({
      failed_count: 5,
      blocked_until: new Date(start.getTime() + 4_000).toISOString(),
    });
  });

  it("applica un ritardo progressivo e azzera i tentativi dopo un accesso valido", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-auth-"));
    directories.push(directory);
    const database = openDatabase(directory);
    await createOwner(database, "FondazioneM2Sicura2026");
    const start = new Date("2026-08-24T10:00:00.000Z");
    await authenticate(database, "errata", "client-sintetico", start);
    await authenticate(database, "errata", "client-sintetico", start);
    await authenticate(database, "errata", "client-sintetico", start);
    await expect(
      authenticate(database, "FondazioneM2Sicura2026", "client-sintetico", start),
    ).resolves.toBeNull();
    const ownerId = await authenticate(
      database,
      "FondazioneM2Sicura2026",
      "client-sintetico",
      new Date(start.getTime() + 1_001),
    );
    expect(ownerId).toBeTruthy();
    expect(
      (database.prepare("SELECT count(*) AS count FROM login_attempts").get() as { count: number })
        .count,
    ).toBe(0);
  });
});
