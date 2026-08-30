import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  assertPublicationCleanupPossible,
  finalizePublicationCleanup,
  publicationCleanupContext,
} from "./publication-cleanup.mjs";

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "sequent-publication-cleanup-"));
  const remote = join(root, "remote.git");
  const primary = join(root, "primary");
  const linked = join(root, "linked");
  execFileSync("git", ["init", "--bare", remote]);
  execFileSync("git", ["init", "--initial-branch=main", primary]);
  git(primary, "config", "user.name", "Sequent Test");
  git(primary, "config", "user.email", "sequent@example.invalid");
  writeFileSync(join(primary, "value.txt"), "iniziale\n");
  git(primary, "add", "value.txt");
  git(primary, "commit", "-m", "chore: initial");
  git(primary, "remote", "add", "origin", remote);
  git(primary, "push", "--set-upstream", "origin", "main");
  git(primary, "worktree", "add", "-b", "codex/cleanup-test", linked, "main");
  writeFileSync(join(linked, "value.txt"), "pubblicato\n");
  git(linked, "add", "value.txt");
  git(linked, "commit", "-m", "fix: publish value");
  git(linked, "push", "--set-upstream", "origin", "codex/cleanup-test");
  git(primary, "merge", "--squash", "codex/cleanup-test");
  git(primary, "commit", "-m", "fix: publish value");
  git(primary, "push", "origin", "main");
  git(primary, "push", "origin", "--delete", "codex/cleanup-test");
  return { root, primary, linked };
}

test("chiude branch e worktree del ciclo e riallinea main", () => {
  const originalCwd = process.cwd();
  const { root, primary, linked } = fixture();
  try {
    const context = publicationCleanupContext(linked);
    assertPublicationCleanupPossible(context);
    const result = finalizePublicationCleanup(context);
    process.chdir(originalCwd);

    assert.equal(existsSync(linked), false);
    assert.equal(git(primary, "rev-parse", "main"), git(primary, "rev-parse", "origin/main"));
    assert.throws(() => git(primary, "show-ref", "--verify", "refs/heads/codex/cleanup-test"));
    assert.equal(result.branchRimosso, "codex/cleanup-test");
    assert.equal(result.worktreeRimosso, realpathSync(join(linked, "..")) + "/linked");
    assert.deepEqual(result.residuiIntenzionalmentePreservati.localBranches, []);
  } finally {
    process.chdir(originalCwd);
    rmSync(root, { recursive: true, force: true });
  }
});

test("blocca prima delle mutazioni se il worktree di main è sporco", () => {
  const { root, primary, linked } = fixture();
  try {
    writeFileSync(join(primary, "untracked.txt"), "lavoro concorrente\n");
    const context = publicationCleanupContext(linked);
    assert.throws(
      () => assertPublicationCleanupPossible(context),
      /Il worktree di main non è pulito/,
    );
    assert.equal(existsSync(linked), true);
    assert.equal(git(linked, "branch", "--show-current"), "codex/cleanup-test");
  } finally {
    git(primary, "worktree", "remove", "--force", linked);
    rmSync(root, { recursive: true, force: true });
  }
});

test("rifiuta l'esecuzione remota che salta il wrapper di pulizia", () => {
  const script = fileURLToPath(new URL("./publish.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [script, "--execute"], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    encoding: "utf8",
    env: { ...process.env, SEQUENT_PUBLICATION_WRAPPER: "" },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /deve passare da npm run publication:github/);
});
