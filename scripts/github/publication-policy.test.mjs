import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { classifyChangedFiles, githubOutputs, LEVELS } from "./publication-policy.mjs";

test("classifica come rapide soltanto modifiche documentali", () => {
  const result = classifyChangedFiles(["README.md", "docs/runbooks/github.md"]);
  assert.equal(result.level, "rapid");
  assert.equal(result.runBrowser, false);
  assert.equal(result.runArm64, false);
});

test("classifica il normale codice puro come ordinario", () => {
  const result = classifyChangedFiles(["src/lib/format.ts", "tests/unit/search.test.ts"]);
  assert.equal(result.level, "ordinary");
  assert.equal(result.runBrowser, false);
});

test("UI, persistenza e autenticazione attivano i gate pertinenti", () => {
  const ui = classifyChangedFiles(["src/routes/+page.svelte"]);
  assert.equal(ui.level, "sensitive");
  assert.equal(ui.browser, true);
  assert.equal(ui.runBrowser, true);

  const persistence = classifyChangedFiles(["src/lib/server/database.ts"]);
  assert.equal(persistence.level, "sensitive");
  assert.equal(persistence.persistence, true);
  assert.equal(persistence.runBrowser, true);

  const security = classifyChangedFiles(["src/lib/server/auth.ts"]);
  assert.equal(security.level, "sensitive");
  assert.equal(security.security, true);
  assert.equal(security.runBrowser, true);
});

test("runtime, DIZ e fonti ufficiali non possono degradare a gate rapidi", () => {
  assert.equal(classifyChangedFiles(["Dockerfile"]).runArm64, true);
  assert.equal(classifyChangedFiles(["src/domain/diz/archive.ts"]).diz, true);
  assert.equal(
    classifyChangedFiles(["src/domain/official-catalog/semantic-rules.json"]).compliance,
    true,
  );
});

test("una diff vuota usa il fallback conservativo e la release forza la matrice completa", () => {
  assert.equal(classifyChangedFiles([]).level, "sensitive");
  const release = classifyChangedFiles(["docs/MASTER_PLAN.md"], { release: true });
  assert.equal(release.level, "release");
  assert.equal(release.runArm64, true);
  assert.equal(release.runBrowser, true);
});

test("genera output GitHub scalari", () => {
  const output = githubOutputs(classifyChangedFiles(["Dockerfile"]));
  assert.deepEqual(output, {
    level: "sensitive",
    arm64: "true",
    browser: "false",
    compliance: "false",
    diz: "false",
    documents: "false",
    persistence: "false",
    security: "false",
  });
  assert.deepEqual(LEVELS, ["rapid", "ordinary", "sensitive", "release"]);
});

test("la CI aggrega i job pertinenti senza duplicare Doctor", async () => {
  const workflow = await readFile(
    new URL("../../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /name: PR gate/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /npm run verify:application/);
  assert.equal(workflow.match(/npm run doctor/g)?.length, 1);
  assert.match(workflow, /needs\.classify\.outputs\.browser == 'true'/);
  assert.match(workflow, /needs\.classify\.outputs\.arm64 == 'true'/);
});

test("la candidata rilegge lo stesso artefatto ARM64 senza deploy", async () => {
  const workflow = await readFile(
    new URL("../../.github/workflows/release-candidate.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /docker save --output sequent-release-arm64\.tar/);
  assert.match(workflow, /actions\/upload-artifact@[0-9a-f]{40}/);
  assert.match(workflow, /actions\/download-artifact@[0-9a-f]{40}/);
  assert.match(workflow, /release-artifact\.mjs verify/);
  assert.doesNotMatch(workflow, /\bssh\b|deploy/i);
});
