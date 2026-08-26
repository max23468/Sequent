import { describe, expect, it } from "vitest";
import { getCodexCapability } from "../../src/lib/server/codex-capability.ts";

describe("capacità Codex", () => {
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
