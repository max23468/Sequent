import { describe, expect, it } from "vitest";
import {
  MAX_HEALTHY_DISK_USED_PERCENT,
  MIN_HEALTHY_FREE_BYTES,
  isStorageHealthy,
} from "../../src/lib/server/health";

const gibibytes = (value: bigint) => value * 1024n * 1024n * 1024n;

describe("health dello storage", () => {
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
});
