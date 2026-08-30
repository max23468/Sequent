import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = "scripts/vps/configure-runtime-features.mjs";
const migrationScript = "scripts/vps/migrate-runtime-features.py";
const migrationIdentity = [`${process.getuid?.()}`, `${process.getgid?.()}`, "1001", "1001"];

function createRuntime(extra = "") {
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
    const result = spawnSync(process.execPath, [script, "--codex", "false", "--diz", "true"], {
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

test("migra fail-closed la configurazione precedente soltanto quando entrambe le flag mancano", () => {
  const legacy = createRuntime();
  const current = createRuntime("SEQUENT_CODEX_ENABLED=true\nSEQUENT_DIZ_ENABLED=false");
  const partial = createRuntime("SEQUENT_CODEX_ENABLED=true");
  const invalid = createRuntime("SEQUENT_CODEX_ENABLED=true\nSEQUENT_DIZ_ENABLED=forse");
  try {
    const migration = spawnSync(
      "python3",
      [migrationScript, legacy.environment, ...migrationIdentity],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );
    assert.equal(migration.status, 0, migration.stderr);
    assert.match(readFileSync(legacy.environment, "utf8"), /SEQUENT_CODEX_ENABLED=false/);
    assert.match(readFileSync(legacy.environment, "utf8"), /SEQUENT_DIZ_ENABLED=false/);

    const before = readFileSync(current.environment, "utf8");
    const noOp = spawnSync(
      "python3",
      [migrationScript, current.environment, ...migrationIdentity],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );
    assert.equal(noOp.status, 0, noOp.stderr);
    assert.equal(readFileSync(current.environment, "utf8"), before);

    const partialBefore = readFileSync(partial.environment, "utf8");
    const rejected = spawnSync(
      "python3",
      [migrationScript, partial.environment, ...migrationIdentity],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      },
    );
    assert.notEqual(rejected.status, 0);
    assert.equal(readFileSync(partial.environment, "utf8"), partialBefore);

    const invalidBefore = readFileSync(invalid.environment, "utf8");
    const invalidResult = spawnSync(
      "python3",
      [migrationScript, invalid.environment, ...migrationIdentity],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.notEqual(invalidResult.status, 0);
    assert.equal(readFileSync(invalid.environment, "utf8"), invalidBefore);
  } finally {
    rmSync(legacy.root, { recursive: true, force: true });
    rmSync(current.root, { recursive: true, force: true });
    rmSync(partial.root, { recursive: true, force: true });
    rmSync(invalid.root, { recursive: true, force: true });
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
      const result = spawnSync(process.execPath, [script, ...fixture.arguments_], {
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
