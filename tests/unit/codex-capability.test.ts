import { afterEach, describe, expect, it, vi } from "vitest";
import { getCodexCapability } from "../../src/lib/server/codex-capability.ts";

describe("capacità Codex", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("resta spenta per default in produzione senza invocare la CLI", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const runner = vi.fn();
    await expect(getCodexCapability(runner)).resolves.toMatchObject({ state: "disabled" });
    expect(runner).not.toHaveBeenCalled();
  });

  it("accetta soltanto una sessione ChatGPT", async () => {
    await expect(
      getCodexCapability(async () => ({ stdout: "Logged in using ChatGPT", stderr: "" })),
    ).resolves.toMatchObject({ state: "authenticated" });
    await expect(
      getCodexCapability(async () => ({ stdout: "Logged in using an API key", stderr: "" })),
    ).resolves.toMatchObject({ state: "api_key_disallowed" });
  });

  it("espone l'accesso mancante senza attivare fallback", async () => {
    await expect(
      getCodexCapability(async () => {
        throw new Error("TOOL_FAILED:codex:1");
      }),
    ).resolves.toMatchObject({ state: "signed_out" });
  });
});
