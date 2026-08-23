import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("il repository non pubblica target amministrativi SSH", () => {
  const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
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
