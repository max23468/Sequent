import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import {
  changedFiles,
  classifyChangedFiles,
  DIFF_FILTER,
  githubOutputs,
  LEVELS,
  parseChangedPaths,
} from "./publication-policy.mjs";

test("classifica come rapide soltanto modifiche documentali", () => {
  const result = classifyChangedFiles(["README.md", "docs/runbooks/github.md"]);
  assert.equal(result.level, "rapid");
  assert.equal(result.runtime, false);
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
  const image = classifyChangedFiles(["Dockerfile"]);
  assert.equal(image.runArm64, true);
  assert.equal(image.runtime, true);
  assert.equal(classifyChangedFiles(["src/lib/format.ts"]).runtime, true);
  assert.equal(classifyChangedFiles(["src/domain/diz/archive.ts"]).diz, true);
  assert.equal(
    classifyChangedFiles(["src/domain/official-catalog/semantic-rules.json"]).compliance,
    true,
  );
});

test("governance e test non richiedono una release runtime", () => {
  const governance = classifyChangedFiles([
    "AGENTS.md",
    ".github/workflows/release-candidate.yml",
    "scripts/github/publish.mjs",
    "scripts/github/publish.test.mjs",
  ]);
  assert.equal(governance.level, "sensitive");
  assert.equal(governance.runtime, false);
  assert.deepEqual(governance.unknown, []);
});

test("un percorso sconosciuto fallisce chiuso anche sull'impatto runtime", () => {
  const result = classifyChangedFiles(["nuova-superficie.bin"]);
  assert.equal(result.level, "sensitive");
  assert.equal(result.runtime, true);
  assert.deepEqual(result.unknown, ["nuova-superficie.bin"]);
});

test("una diff vuota usa il fallback conservativo e la release forza la matrice completa", () => {
  const empty = classifyChangedFiles([]);
  assert.equal(empty.level, "sensitive");
  assert.equal(empty.runtime, true);
  const release = classifyChangedFiles(["docs/MASTER_PLAN.md"], { release: true });
  assert.equal(release.level, "release");
  assert.equal(release.runArm64, true);
  assert.equal(release.runBrowser, true);
});

test("include le eliminazioni nella classificazione della diff", async () => {
  const repository = await mkdtemp(join(tmpdir(), "sequent-publication-policy-"));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: repository,
      env: {
        ...process.env,
        GIT_AUTHOR_EMAIL: "test@example.invalid",
        GIT_AUTHOR_NAME: "Sequent test",
        GIT_COMMITTER_EMAIL: "test@example.invalid",
        GIT_COMMITTER_NAME: "Sequent test",
      },
      stdio: "ignore",
    });

  try {
    git("init", "--quiet");
    await writeFile(join(repository, "Dockerfile"), "FROM scratch\n");
    git("add", "Dockerfile");
    git("commit", "--quiet", "-m", "test: add Dockerfile");
    await rm(join(repository, "Dockerfile"));
    git("add", "--all");
    git("commit", "--quiet", "-m", "test: remove Dockerfile");

    const previousDirectory = process.cwd();
    process.chdir(repository);
    try {
      const files = changedFiles("HEAD~1");
      assert.deepEqual(files, ["Dockerfile"]);
      assert.equal(classifyChangedFiles(files).runArm64, true);
    } finally {
      process.chdir(previousDirectory);
    }
  } finally {
    await rm(repository, { recursive: true, force: true });
  }

  assert.match(DIFF_FILTER, /D/);
});

test("classifica entrambi i percorsi di una rinomina", async () => {
  const repository = await mkdtemp(join(tmpdir(), "sequent-publication-rename-"));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: repository,
      env: {
        ...process.env,
        GIT_AUTHOR_EMAIL: "test@example.invalid",
        GIT_AUTHOR_NAME: "Sequent test",
        GIT_COMMITTER_EMAIL: "test@example.invalid",
        GIT_COMMITTER_NAME: "Sequent test",
      },
      stdio: "ignore",
    });

  try {
    git("init", "--quiet");
    await writeFile(join(repository, "Dockerfile"), "FROM scratch\n");
    git("add", "Dockerfile");
    git("commit", "--quiet", "-m", "test: add Dockerfile");
    git("mv", "Dockerfile", "notes.txt");
    git("commit", "--quiet", "-m", "test: rename Dockerfile");

    const previousDirectory = process.cwd();
    process.chdir(repository);
    try {
      const files = changedFiles("HEAD~1");
      assert.deepEqual(files, ["Dockerfile", "notes.txt"]);
      assert.equal(classifyChangedFiles(files).runArm64, true);
    } finally {
      process.chdir(previousDirectory);
    }
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

test("fallisce chiuso su una rinomina Git malformata", () => {
  assert.throws(() => parseChangedPaths("R100\0Dockerfile\0"), /senza destinazione/);
});

test("genera output GitHub scalari", () => {
  const output = githubOutputs(classifyChangedFiles(["Dockerfile"]));
  assert.deepEqual(output, {
    level: "sensitive",
    runtime: "true",
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
  assert.match(
    workflow,
    /npm run benchmark:extraction-safety -- --dataset tests\/fixtures\/extraction-safety-benchmark\.synthetic\.json/,
  );
  assert.match(workflow, /release-review\.mjs --commit/);
  assert.match(workflow, /name: Scansione dipendenze release/);
  assert.match(workflow, /scan source --lockfile package-lock\.json/);
  assert.match(workflow, /name: Scansione immagine ARM64 release/);
  const imageScanJob = workflow.match(/  scan-image:\n(?<job>[\s\S]*?)\n  release-candidate-gate:/)
    ?.groups?.job;
  assert.ok(imageScanJob, "job scan-image assente");
  assert.match(imageScanJob, /actions\/checkout@[0-9a-f]{40}/);
  assert.match(imageScanJob, /ref: \$\{\{ inputs\.commit \}\}/);
  assert.match(imageScanJob, /persist-credentials: false/);
  assert.match(
    workflow,
    /scan image --format vertical --archive \/scan\/sequent-release-arm64\.tar/,
  );
  assert.match(workflow, /image-vulnerability-gate\.mjs image-vulnerability-report\.txt/);
  assert.equal(workflow.match(/ghcr\.io\/google\/osv-scanner@sha256:[0-9a-f]{64}/g)?.length, 2);
  assert.match(workflow, /needs\.scan-dependencies\.result/);
  assert.match(workflow, /needs\.scan-image\.result/);
  assert.doesNotMatch(workflow, /\bssh\b|deploy/i);
});
