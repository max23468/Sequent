import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("qualificazione privata del runtime Codex", () => {
  it("rifiuta una prova non legata alla release prima di usare il runtime", () => {
    const result = spawnSync(process.execPath, ["scripts/admin/qualify-codex-runtime.ts"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, OPENAI_API_KEY: "", SEQUENT_COMMIT_SHA: "" },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("CODEX_QUALIFICATION_RELEASE_REQUIRED");
  });

  it("rifiuta la API key prima di interrogare la sessione ChatGPT", () => {
    const result = spawnSync(process.execPath, ["scripts/admin/qualify-codex-runtime.ts"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        OPENAI_API_KEY: "non-ammessa",
        SEQUENT_COMMIT_SHA: "c".repeat(40),
        SEQUENT_CODEX_ENABLED: "true",
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("CODEX_QUALIFICATION_API_KEY_DISALLOWED");
  });
});
