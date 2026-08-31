import { mkdtempSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertChatGPTLoginStatus,
  buildCodexLoginEnvironment,
  prepareDedicatedCodexHome,
} from "../../src/lib/server/codex-login.ts";

describe("collegamento Codex dedicato", () => {
  const directories: string[] = [];

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const directory of directories.splice(0))
      rmSync(directory, { recursive: true, force: true });
  });

  it("crea la home dedicata privata senza usare la home generale", async () => {
    const root = mkdtempSync(join(tmpdir(), "sequent-codex-login-"));
    directories.push(root);
    const dedicatedHome = join(root, "dedicated");
    vi.stubEnv("SEQUENT_CODEX_HOME", dedicatedHome);

    const preparedHome = await prepareDedicatedCodexHome();

    expect(preparedHome).toBe(realpathSync(dedicatedHome));
    expect(statSync(dedicatedHome).mode & 0o777).toBe(0o700);
  });

  it("passa alla CLI soltanto la home dedicata e non una API key", () => {
    vi.stubEnv("OPENAI_API_KEY", "non-deve-essere-ereditata");
    const environment = buildCodexLoginEnvironment("/var/lib/sequent/.codex-sequent");

    expect(environment.CODEX_HOME).toBe("/var/lib/sequent/.codex-sequent");
    expect(environment).not.toHaveProperty("OPENAI_API_KEY");
  });

  it("accetta ChatGPT e rifiuta API key o stato disconnesso", () => {
    expect(() => assertChatGPTLoginStatus("Logged in using ChatGPT")).not.toThrow();
    expect(() => assertChatGPTLoginStatus("Logged in using an API key")).toThrow(
      "CODEX_API_KEY_DISALLOWED",
    );
    expect(() => assertChatGPTLoginStatus("Not logged in")).toThrow("CODEX_CHATGPT_LOGIN_REQUIRED");
  });
});
