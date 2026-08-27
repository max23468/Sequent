import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { codexAnalysisInternals } from "../../src/lib/server/codex-analysis.ts";

const originalSecret = process.env.SEQUENT_TEST_SECRET;
const originalCodexHome = process.env.SEQUENT_CODEX_HOME;
const directories: string[] = [];

afterEach(() => {
  if (originalSecret === undefined) delete process.env.SEQUENT_TEST_SECRET;
  else process.env.SEQUENT_TEST_SECRET = originalSecret;
  if (originalCodexHome === undefined) delete process.env.SEQUENT_CODEX_HOME;
  else process.env.SEQUENT_CODEX_HOME = originalCodexHome;
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("confine runtime Codex", () => {
  it("espone soltanto l'ambiente necessario e rende leggibile il solo workspace", () => {
    process.env.SEQUENT_TEST_SECRET = "non-esporre";
    const options = codexAnalysisInternals.buildCodexRuntimeOptions(
      "/tmp/practice-123",
      "/var/lib/sequent/.codex",
    );

    expect(options.env?.SEQUENT_TEST_SECRET).toBeUndefined();
    expect(options.config).toMatchObject({
      default_permissions: "sequent_practice",
      features: {
        apps: false,
        browser_use: false,
        computer_use: false,
        hooks: false,
        memories: false,
        multi_agent: false,
        plugins: false,
        remote_plugin: false,
        skill_search: false,
        view_image: false,
      },
    });
    expect(options.configOverrides).toContain(
      'permissions.sequent_practice.filesystem={":minimal"="read",":root"="deny","/tmp/practice-123"="read"}',
    );
    expect(options.configOverrides).toContain(
      "permissions.sequent_practice.network={enabled=false}",
    );
    expect(options.configOverrides).toContain("mcp_servers={}");
  });

  it("fallisce chiuso se la home Codex contiene configurazioni o estensioni", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-codex-home-"));
    directories.push(directory);
    process.env.SEQUENT_CODEX_HOME = directory;
    writeFileSync(
      join(directory, "config.toml"),
      '[mcp_servers.estraneo]\nurl="https://example.test"\n',
    );

    await expect(codexAnalysisInternals.requireDedicatedCodexHome()).rejects.toThrow(
      "CODEX_HOME_NOT_DEDICATED",
    );
    rmSync(join(directory, "config.toml"));
    mkdirSync(join(directory, "plugins"));
    await expect(codexAnalysisInternals.requireDedicatedCodexHome()).rejects.toThrow(
      "CODEX_HOME_NOT_DEDICATED",
    );
  });

  it("accetta i file di stato e le skill create automaticamente dalla CLI", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sequent-codex-runtime-home-"));
    directories.push(directory);
    process.env.SEQUENT_CODEX_HOME = directory;
    mkdirSync(join(directory, "skills"));
    writeFileSync(join(directory, "state.sqlite"), "");

    await expect(codexAnalysisInternals.requireDedicatedCodexHome()).resolves.toBe(directory);
  });

  it("distingue il timeout della run dalla cancellazione richiesta dall'utente", () => {
    const timeout = new AbortController();
    const request = new AbortController();
    const timedRun = codexAnalysisInternals.createCodexRunSignal(request.signal, timeout.signal);

    timeout.abort();
    expect(timedRun.signal.aborted).toBe(true);
    expect(timedRun.timedOut()).toBe(true);

    const cancelledRequest = new AbortController();
    const pendingTimeout = new AbortController();
    const cancelledRun = codexAnalysisInternals.createCodexRunSignal(
      cancelledRequest.signal,
      pendingTimeout.signal,
    );
    cancelledRequest.abort();
    expect(cancelledRun.signal.aborted).toBe(true);
    expect(cancelledRun.timedOut()).toBe(false);
  });
});
