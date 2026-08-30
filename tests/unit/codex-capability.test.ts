import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getCodexCapability } from "../../src/lib/server/codex-capability.ts";
import type { CommandRunner } from "../../src/lib/server/process-tools.ts";

describe("capacità Codex", () => {
  const directories: string[] = [];

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const directory of directories.splice(0))
      rmSync(directory, { recursive: true, force: true });
  });

  function enableCodex(): void {
    vi.stubEnv("SEQUENT_CODEX_ENABLED", "true");
    const directory = mkdtempSync(join(tmpdir(), "sequent-capability-codex-home-"));
    directories.push(directory);
    vi.stubEnv("SEQUENT_CODEX_HOME", directory);
  }

  it("resta spenta per default in produzione senza invocare la CLI", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const runner = vi.fn();
    await expect(getCodexCapability(runner)).resolves.toMatchObject({ state: "disabled" });
    expect(runner).not.toHaveBeenCalled();
  });

  it("accetta soltanto una sessione ChatGPT", async () => {
    enableCodex();
    const runner = vi.fn<CommandRunner>(async () => ({
      stdout: "Logged in using ChatGPT",
      stderr: "",
    }));
    await expect(getCodexCapability(runner)).resolves.toMatchObject({ state: "authenticated" });
    expect(runner).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(["login", "status"]),
      expect.objectContaining({
        env: expect.objectContaining({ CODEX_HOME: realpathSync(process.env.SEQUENT_CODEX_HOME!) }),
      }),
    );
    expect(runner.mock.calls[0]?.[2]?.env).not.toHaveProperty("OPENAI_API_KEY");
    await expect(
      getCodexCapability(async () => ({ stdout: "Logged in using an API key", stderr: "" })),
    ).resolves.toMatchObject({ state: "api_key_disallowed" });
  });

  it("rifiuta la API key prima di invocare la CLI", async () => {
    enableCodex();
    vi.stubEnv("OPENAI_API_KEY", "chiave-non-ammessa");
    const runner = vi.fn();

    await expect(getCodexCapability(runner)).resolves.toMatchObject({
      state: "api_key_disallowed",
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it("non confonde uno stato disconnesso con una sessione valida", async () => {
    enableCodex();
    await expect(
      getCodexCapability(async () => ({ stdout: "Not logged in with ChatGPT", stderr: "" })),
    ).resolves.toMatchObject({ state: "signed_out" });
  });

  it("fallisce visibilmente se manca la home dedicata", async () => {
    vi.stubEnv("SEQUENT_CODEX_ENABLED", "true");
    vi.stubEnv("SEQUENT_CODEX_HOME", "");
    const runner = vi.fn();

    await expect(getCodexCapability(runner)).resolves.toMatchObject({ state: "unavailable" });
    expect(runner).not.toHaveBeenCalled();
  });

  it("espone l'accesso mancante senza attivare fallback", async () => {
    enableCodex();
    await expect(
      getCodexCapability(async () => {
        throw new Error("TOOL_FAILED:codex:1");
      }),
    ).resolves.toMatchObject({ state: "signed_out" });
  });
});
