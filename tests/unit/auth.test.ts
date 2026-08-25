import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  authenticate,
  createOwner,
  createOwnerSession,
  ensureDevelopmentOwner,
} from "../../src/lib/server/auth.ts";
import { getDevelopmentPassword, useDevelopmentAutoLogin } from "../../src/lib/server/config.ts";
import { closeDatabase, openDatabase } from "../../src/lib/server/database.ts";

const directories: string[] = [];

afterEach(() => {
  delete process.env.SEQUENT_DEV_AUTO_LOGIN;
  delete process.env.SEQUENT_DEV_PASSWORD;
  for (const directory of directories.splice(0)) {
    closeDatabase(directory);
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("difesa del login", () => {
  it("crea una sola identità dev concorrente e riusa l'owner esistente", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-auth-development-"));
    directories.push(directory);
    const database = openDatabase(directory);

    const [firstOwnerId, secondOwnerId] = await Promise.all([
      ensureDevelopmentOwner(database, "PasswordDevSintetica2026"),
      ensureDevelopmentOwner(database, "PasswordDevSintetica2026"),
    ]);
    expect(secondOwnerId).toBe(firstOwnerId);
    expect(await ensureDevelopmentOwner(database, "PasswordDevSintetica2026")).toBe(firstOwnerId);
    expect(database.prepare("SELECT count(*) AS count FROM owner").get()).toMatchObject({
      count: 1,
    });
  });

  it("abilita l'auto-login soltanto in sviluppo e consente l'opt-out", () => {
    expect(useDevelopmentAutoLogin(true, "127.0.0.1")).toBe(true);
    expect(useDevelopmentAutoLogin(true, "::1")).toBe(true);
    expect(useDevelopmentAutoLogin(false, "127.0.0.1")).toBe(false);
    expect(useDevelopmentAutoLogin(true, "192.0.2.10")).toBe(false);
    process.env.SEQUENT_DEV_AUTO_LOGIN = "false";
    expect(useDevelopmentAutoLogin(true, "127.0.0.1")).toBe(false);
    expect(getDevelopmentPassword()).toBe("FondazioneM2Sicura2026");
    process.env.SEQUENT_DEV_PASSWORD = "OverrideDevSintetico2026";
    expect(getDevelopmentPassword()).toBe("OverrideDevSintetico2026");
  });

  it("non lascia un owner incompleto se la creazione della sessione iniziale fallisce", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-auth-atomic-"));
    directories.push(directory);
    const database = openDatabase(directory);
    database.exec(`
      CREATE TRIGGER reject_initial_session
      BEFORE INSERT ON sessions
      BEGIN
        SELECT RAISE(ABORT, 'sessione sintetica rifiutata');
      END;
    `);

    await expect(createOwnerSession(database, "FondazioneM2Sicura2026")).rejects.toThrow(
      "sessione sintetica rifiutata",
    );
    expect(database.prepare("SELECT count(*) AS count FROM owner").get()).toMatchObject({
      count: 0,
    });
  });

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
