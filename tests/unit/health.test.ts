import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  MAX_HEALTHY_DISK_USED_PERCENT,
  MIN_HEALTHY_FREE_BYTES,
  getOperationalHealth,
  isDatabaseResponsive,
  isStorageHealthy,
} from "../../src/lib/server/health";

const gibibytes = (value: bigint) => value * 1024n * 1024n * 1024n;

describe("health dello storage", () => {
  it("usa una query di readiness costante e fallisce chiuso", () => {
    const statements: string[] = [];
    const responsive = {
      prepare(statement: string) {
        statements.push(statement);
        return { get: () => ({ responsive: 1 }) };
      },
    } as unknown as Database.Database;
    expect(isDatabaseResponsive(responsive)).toBe(true);
    expect(statements).toEqual(["SELECT 1 AS responsive"]);

    const unavailable = {
      prepare() {
        throw new Error("database non disponibile");
      },
    } as unknown as Database.Database;
    expect(isDatabaseResponsive(unavailable)).toBe(false);
  });

  it("accetta spazio libero e percentuale entro soglia", () => {
    expect(isStorageHealthy({ bavail: gibibytes(10n), blocks: gibibytes(47n), bsize: 1n })).toBe(
      true,
    );
  });

  it("fallisce quando restano meno di cinque GiB", () => {
    expect(
      isStorageHealthy({
        bavail: MIN_HEALTHY_FREE_BYTES - 1n,
        blocks: gibibytes(47n),
        bsize: 1n,
      }),
    ).toBe(false);
  });

  it("fallisce al novanta per cento di utilizzo", () => {
    const total = gibibytes(100n);
    const available = (total * (100n - MAX_HEALTHY_DISK_USED_PERCENT)) / 100n;
    expect(isStorageHealthy({ bavail: available, blocks: total, bsize: 1n })).toBe(false);
  });

  it("fallisce su un filesystem senza dimensione valida", () => {
    expect(isStorageHealthy({ bavail: 0n, blocks: 0n, bsize: 1n })).toBe(false);
  });

  it("riassume archivio, spazio ed errori recenti senza esporre dettagli", () => {
    const database = new Database(":memory:");
    try {
      database.exec(
        "CREATE TABLE jobs(status TEXT, updated_at TEXT); INSERT INTO jobs VALUES ('failed', '2026-08-30T00:00:00.000Z'), ('failed', '2026-08-29T00:00:00.000Z')",
      );
      expect(
        getOperationalHealth(
          database,
          {
            bavail: gibibytes(10n),
            blocks: gibibytes(47n),
            bsize: 1n,
          },
          new Date("2026-08-30T12:00:00.000Z"),
        ),
      ).toEqual({ databaseHealthy: true, storageHealthy: true, recentErrors: 2 });
    } finally {
      database.close();
    }
  });
});
