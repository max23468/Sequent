import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  authenticate,
  createOwner,
  createOwnerSession,
  ensureDevelopmentOwner,
  issueSession,
  normalizeUsername,
  readSession,
  resetOwnerCredentials,
} from "../../src/lib/server/auth.ts";
import {
  getDevelopmentPassword,
  getDevelopmentUsername,
  useDevelopmentAutoLogin,
  useWebOwnerSetup,
} from "../../src/lib/server/config.ts";
import { closeDatabase, openDatabase } from "../../src/lib/server/database.ts";

const directories: string[] = [];

afterEach(() => {
  delete process.env.SEQUENT_DEV_AUTO_LOGIN;
  delete process.env.SEQUENT_DEV_PASSWORD;
  delete process.env.SEQUENT_DEV_USERNAME;
  vi.unstubAllEnvs();
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
      ensureDevelopmentOwner(database, "Sviluppo", "PasswordDevSintetica2026"),
      ensureDevelopmentOwner(database, "Sviluppo", "PasswordDevSintetica2026"),
    ]);
    expect(secondOwnerId).toBe(firstOwnerId);
    expect(await ensureDevelopmentOwner(database, "Sviluppo", "PasswordDevSintetica2026")).toBe(
      firstOwnerId,
    );
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
    expect(getDevelopmentPassword()).toBe("SequentSviluppoSicuro2026");
    expect(getDevelopmentUsername()).toBe("Sviluppo");
    process.env.SEQUENT_DEV_PASSWORD = "OverrideDevSintetico2026";
    process.env.SEQUENT_DEV_USERNAME = "Operatore dev";
    expect(getDevelopmentPassword()).toBe("OverrideDevSintetico2026");
    expect(getDevelopmentUsername()).toBe("Operatore dev");
  });

  it("disabilita il setup web in Production senza flag di riapertura", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(useWebOwnerSetup()).toBe(false);
    vi.stubEnv("NODE_ENV", "test");
    expect(useWebOwnerSetup()).toBe(true);
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

    await expect(
      createOwnerSession(database, "Sviluppo", "SequentSviluppoSicuro2026"),
    ).rejects.toThrow("sessione sintetica rifiutata");
    expect(database.prepare("SELECT count(*) AS count FROM owner").get()).toMatchObject({
      count: 0,
    });
  });

  it("contabilizza atomicamente i tentativi simultanei della stessa origine", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-auth-concurrent-"));
    directories.push(directory);
    const database = openDatabase(directory);
    await createOwner(database, "Sviluppo", "SequentSviluppoSicuro2026");
    const start = new Date("2026-08-24T10:00:00.000Z");

    await Promise.all(
      Array.from({ length: 5 }, () =>
        authenticate(database, "Sviluppo", "errata", "client-concorrente", start),
      ),
    );

    const attempts = database
      .prepare("SELECT failed_count, blocked_until FROM login_attempts")
      .all() as Array<{ failed_count: number; blocked_until: string }>;
    expect(attempts).toHaveLength(2);
    expect(attempts).toEqual(
      expect.arrayContaining([
        {
          failed_count: 5,
          blocked_until: new Date(start.getTime() + 4_000).toISOString(),
        },
        {
          failed_count: 5,
          blocked_until: new Date(start.getTime() + 4_000).toISOString(),
        },
      ]),
    );
  });

  it("limita lo stesso account quando l'origine cambia senza bloccare username diversi", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-auth-account-limit-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const ownerId = await createOwner(database, "Sviluppo", "SequentSviluppoSicuro2026");
    const start = new Date("2026-08-24T10:00:00.000Z");

    for (const client of ["client-a", "client-b", "client-c"]) {
      await authenticate(database, "Sviluppo", "errata", client, start);
    }
    await expect(
      authenticate(database, "Sviluppo", "SequentSviluppoSicuro2026", "client-d", start),
    ).resolves.toBeNull();
    await expect(
      authenticate(
        database,
        "Sviluppo",
        "SequentSviluppoSicuro2026",
        "client-d",
        new Date(start.getTime() + 1_001),
      ),
    ).resolves.toBe(ownerId);

    const later = new Date(start.getTime() + 2_000);
    for (const client of ["client-e", "client-f", "client-g"]) {
      await authenticate(database, "username-inesistente", "errata", client, later);
    }
    await expect(
      authenticate(database, "Sviluppo", "SequentSviluppoSicuro2026", "client-h", later),
    ).resolves.toBe(ownerId);
  });

  it("applica un ritardo progressivo e azzera i tentativi dopo un accesso valido", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-auth-"));
    directories.push(directory);
    const database = openDatabase(directory);
    await createOwner(database, "Sviluppo", "SequentSviluppoSicuro2026");
    const start = new Date("2026-08-24T10:00:00.000Z");
    await authenticate(database, "sviluppo", "errata", "client-sintetico", start);
    await authenticate(database, "SVILUPPO", "errata", "client-sintetico", start);
    await authenticate(database, "Sviluppo", "errata", "client-sintetico", start);
    await expect(
      authenticate(database, "sviluppo", "SequentSviluppoSicuro2026", "client-sintetico", start),
    ).resolves.toBeNull();
    const ownerId = await authenticate(
      database,
      "SVILUPPO",
      "SequentSviluppoSicuro2026",
      "client-sintetico",
      new Date(start.getTime() + 1_001),
    );
    expect(ownerId).toBeTruthy();
    expect(
      (database.prepare("SELECT count(*) AS count FROM login_attempts").get() as { count: number })
        .count,
    ).toBe(0);
  });

  it("rinnova una sessione attiva senza scrivere a ogni richiesta", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-auth-renewal-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const ownerId = await createOwner(database, "Sviluppo", "SequentSviluppoSicuro2026");
    const start = new Date("2026-08-24T10:00:00.000Z");
    const session = issueSession(database, ownerId, start);

    expect(readSession(database, session.token, new Date(start.getTime() + 60_000))).toMatchObject({
      id: session.id,
      username: "Sviluppo",
      renewed: false,
    });
    const renewal = new Date(start.getTime() + 25 * 60 * 60 * 1_000);
    expect(readSession(database, session.token, renewal)).toMatchObject({
      id: session.id,
      renewed: true,
    });
    expect(
      database
        .prepare("SELECT last_seen_at, expires_at FROM sessions WHERE id = ?")
        .get(session.id),
    ).toEqual({
      last_seen_at: renewal.toISOString(),
      expires_at: new Date(renewal.getTime() + 365 * 86_400_000).toISOString(),
    });
  });

  it("normalizza lo username senza distinzione fra maiuscole, compatibilità e spazi", () => {
    expect(normalizeUsername("  ROBERTO  ")).toBe("roberto");
    expect(normalizeUsername("Ｒｏｂｅｒｔｏ")).toBe("roberto");
  });

  it("reimposta le credenziali, revoca le sessioni e può ricreare l'owner", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-auth-reset-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const ownerId = await createOwner(database, "Prima identità", "PasswordIniziale2026");
    issueSession(database, ownerId);
    database
      .prepare(
        `INSERT INTO login_attempts(attempt_key, failed_count, blocked_until, updated_at)
         VALUES ('client-reset', 2, NULL, ?)`,
      )
      .run(new Date().toISOString());

    expect(await resetOwnerCredentials(database, "Nuova identità", "PasswordNuova2026")).toBe(
      ownerId,
    );
    expect(database.prepare("SELECT username, username_normalized FROM owner").get()).toEqual({
      username: "Nuova identità",
      username_normalized: "nuova identità",
    });
    expect(database.prepare("SELECT count(*) AS count FROM sessions").get()).toEqual({ count: 0 });
    expect(database.prepare("SELECT count(*) AS count FROM login_attempts").get()).toEqual({
      count: 0,
    });
    await expect(
      authenticate(database, "NUOVA IDENTITÀ", "PasswordNuova2026", "client-dopo-reset"),
    ).resolves.toBe(ownerId);
  });
});
