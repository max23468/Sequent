import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("il repository non pubblica target amministrativi SSH", () => {
  const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter((path) => path && existsSync(path));
  const administrativeTarget = /\b(?:root|ubuntu|admin)@[a-z0-9][a-z0-9.-]+\.[a-z]{2,}\b/i;
  const remoteShellUrl = /\b(?:ssh|sftp):\/\/[^\s`]+/i;

  for (const path of tracked) {
    const content = read(path);
    assert.doesNotMatch(content, administrativeTarget, `${path} contiene un target SSH`);
    assert.doesNotMatch(content, remoteShellUrl, `${path} contiene un endpoint amministrativo`);
  }
});

test("il preflight richiede gli identificatori dalla configurazione privata", () => {
  const preflight = read("scripts/vps/preflight.sh");

  assert.doesNotMatch(preflight, /SEQUENT_EXPECTED_HOST:-[^}]/);
  assert.doesNotMatch(preflight, /SEQUENT_SHARED_INSTALLATION_MARKER:-[^}]/);
  assert.match(preflight, /source "\$preflight_env"/);
  assert.match(preflight, /"\$\(id -un\):600"/);
});

test("il runbook non include utente, hostname o endpoint amministrativi reali", () => {
  const runbook = read("docs/runbooks/vps.md");

  assert.doesNotMatch(runbook, /accesso amministrativo:[^\n]*\b(?:come|tramite)\b/);
  assert.match(runbook, /alias SSH configurato localmente/);
  assert.match(runbook, /preflight\.env/);
});

test("il runtime dietro Caddy dichiara origine HTTPS e singolo proxy fidato", () => {
  const compose = read("deploy/compose.example.yml");
  const dockerfile = read("Dockerfile");
  const runbook = read("docs/runbooks/vps.md");

  assert.match(compose, /ORIGIN: \$\{SEQUENT_ORIGIN:\?[^}]+\}/);
  assert.match(compose, /ADDRESS_HEADER: X-Forwarded-For/);
  assert.match(compose, /XFF_DEPTH: "1"/);
  assert.match(compose, /127\.0\.0\.1:3300:3000/);
  assert.match(
    compose,
    /\/tmp:size=256m,mode=1770,uid=\$\{SEQUENT_RUNTIME_UID:\?[^}]+\},gid=\$\{SEQUENT_RUNTIME_GID:\?[^}]+\}/,
  );
  assert.match(dockerfile, /ca-certificates/);
  assert.match(dockerfile, /'X-Forwarded-For':'127\.0\.0\.1'/);
  assert.match(runbook, /SEQUENT_ORIGIN/);
  assert.match(runbook, /tmpfs.*stessi UID e GID/);
  assert.match(runbook, /sovrascrivere gli header inoltrati dal client/);
  assert.match(runbook, /unico hop davanti a Sequent/);
});

test("la toolchain conserva e qualifica lo slot di rollback", () => {
  const root = mkdtempSync(join(tmpdir(), "sequent-toolchains-"));
  const versions = join(root, "versions");
  mkdirSync(versions, { recursive: true });

  const createToolchain = (name: string, version: string) => {
    const binaryDirectory = join(versions, name, "bin");
    mkdirSync(binaryDirectory, { recursive: true });
    for (const binary of ["node", "npm"]) {
      const path = join(binaryDirectory, binary);
      writeFileSync(path, `#!/usr/bin/env bash\nprintf '%s\\n' '${version}'\n`, { mode: 0o755 });
    }
  };

  try {
    createToolchain("linea-precedente", "precedente");
    createToolchain("linea-candidata", "candidata");
    symlinkSync("versions/linea-precedente", join(root, "node-current"));

    execFileSync("bash", ["scripts/vps/select-node-toolchain.sh", "linea-candidata"], {
      env: { ...process.env, SEQUENT_TOOLCHAIN_ROOT: root },
    });
    assert.equal(readlinkSync(join(root, "node-current")), "versions/linea-candidata");
    assert.equal(readlinkSync(join(root, "node-rollback")), "versions/linea-precedente");

    execFileSync("bash", ["scripts/vps/select-node-toolchain.sh", "--rollback"], {
      env: { ...process.env, SEQUENT_TOOLCHAIN_ROOT: root },
    });
    assert.equal(readlinkSync(join(root, "node-current")), "versions/linea-precedente");
    assert.equal(readlinkSync(join(root, "node-rollback")), "versions/linea-candidata");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
