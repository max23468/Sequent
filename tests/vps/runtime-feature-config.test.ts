import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = "scripts/vps/configure-runtime-features.py";

function createRuntime(extra = "SEQUENT_CODEX_ENABLED=false\nSEQUENT_DIZ_ENABLED=false") {
  const root = mkdtempSync(join(tmpdir(), "sequent-runtime-features-"));
  const runtime = join(root, "runtime");
  mkdirSync(runtime);
  const environment = join(runtime, "runtime.env");
  writeFileSync(
    environment,
    [
      "SEQUENT_IMAGE=sha256:" + "a".repeat(64),
      "SEQUENT_RUNTIME_UID=1001",
      "SEQUENT_RUNTIME_GID=1001",
      "SEQUENT_ORIGIN=https://sequent.example.test",
      extra,
    ]
      .filter(Boolean)
      .join("\n") + "\n",
  );
  chmodSync(environment, 0o600);
  return { root, environment };
}

test("configura atomicamente entrambe le feature flag senza alterare le altre chiavi", () => {
  const fixture = createRuntime();
  try {
    const result = spawnSync("python3", [script, "--codex", "false", "--diz", "true"], {
      cwd: process.cwd(),
      env: { ...process.env, SEQUENT_ROOT: fixture.root },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      readFileSync(fixture.environment, "utf8"),
      [
        "SEQUENT_IMAGE=sha256:" + "a".repeat(64),
        "SEQUENT_RUNTIME_UID=1001",
        "SEQUENT_RUNTIME_GID=1001",
        "SEQUENT_ORIGIN=https://sequent.example.test",
        "SEQUENT_CODEX_ENABLED=false",
        "SEQUENT_DIZ_ENABLED=true",
        "",
      ].join("\n"),
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("richiede entrambe le feature flag nella configurazione corrente", () => {
  const fixture = createRuntime("SEQUENT_CODEX_ENABLED=true");
  try {
    const before = readFileSync(fixture.environment, "utf8");
    const result = spawnSync("python3", [script, "--codex", "false", "--diz", "true"], {
      cwd: process.cwd(),
      env: { ...process.env, SEQUENT_ROOT: fixture.root },
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(fixture.environment, "utf8"), before);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("rifiuta valori, chiavi e permessi non conformi senza sostituire il file", () => {
  const invalidPermissions = createRuntime();
  chmodSync(invalidPermissions.environment, 0o644);
  for (const fixture of [
    {
      created: createRuntime("CHIAVE_ESTRANEA=true"),
      arguments_: ["--codex", "false", "--diz", "true"],
    },
    { created: createRuntime(), arguments_: ["--codex", "false", "--diz", "forse"] },
    {
      created: invalidPermissions,
      arguments_: ["--codex", "false", "--diz", "true"],
    },
  ]) {
    try {
      const before = readFileSync(fixture.created.environment, "utf8");
      const result = spawnSync("python3", [script, ...fixture.arguments_], {
        cwd: process.cwd(),
        env: { ...process.env, SEQUENT_ROOT: fixture.created.root },
        encoding: "utf8",
      });
      assert.notEqual(result.status, 0);
      assert.equal(readFileSync(fixture.created.environment, "utf8"), before);
    } finally {
      rmSync(fixture.created.root, { recursive: true, force: true });
    }
  }
});
