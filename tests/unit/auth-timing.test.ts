import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const verifyMock = vi.hoisted(() =>
  vi.fn(async (_passwordHash: string, _password: string) => false),
);

vi.mock("argon2", () => ({
  hash: vi.fn(async () => "hash-sintetico"),
  verify: verifyMock,
}));

import { authenticate } from "../../src/lib/server/auth.ts";
import { closeDatabase, openDatabase } from "../../src/lib/server/database.ts";

const directories: string[] = [];

afterEach(() => {
  verifyMock.mockClear();
  for (const directory of directories.splice(0)) {
    closeDatabase(directory);
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("verifica uniforme delle credenziali", () => {
  it("esegue Argon2 una volta anche per username inesistente e database senza owner", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-auth-timing-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const now = new Date("2026-08-31T08:00:00.000Z");

    await expect(authenticate(database, "inesistente", "errata", "client-a", now)).resolves.toBe(
      null,
    );
    expect(verifyMock).toHaveBeenCalledTimes(1);
    expect(verifyMock.mock.calls[0]?.[0]).toMatch(/^\$argon2id\$/u);

    database
      .prepare(
        `INSERT INTO owner(
           id, username, username_normalized, password_hash, created_at, password_changed_at
         ) VALUES ('owner', 'Sviluppo', 'sviluppo', 'hash-owner', ?, ?)`,
      )
      .run(now.toISOString(), now.toISOString());
    await expect(authenticate(database, "altro-username", "errata", "client-b", now)).resolves.toBe(
      null,
    );
    expect(verifyMock).toHaveBeenCalledTimes(2);
    expect(verifyMock.mock.calls[1]?.[0]).toBe("hash-owner");
  });
});
