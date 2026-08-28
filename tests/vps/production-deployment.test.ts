import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("Production distribuisce soltanto una candidata ARM64 exact-run", () => {
  const workflow = read(".github/workflows/production.yml");

  assert.match(workflow, /^name: Production$/m);
  assert.match(workflow, /permissions:\n  actions: read\n  contents: read\n  deployments: write/);
  assert.match(workflow, /environment: Production/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /test .*\.head_sha.*CANDIDATE_COMMIT/);
  assert.match(workflow, /test .*\.conclusion.*success/);
  assert.match(workflow, /\.github\/workflows\/release-candidate\.yml/);
  assert.match(workflow, /actions\/download-artifact@[0-9a-f]{40} # v8\.0\.1/);
  assert.match(workflow, /run-id: \$\{\{ inputs\.release_run \}\}/);
  assert.match(workflow, /release-artifact\.mjs verify/);
  assert.match(workflow, /task: "sequent-production"/);
  assert.match(workflow, /deploy-release\.sh --commit/);
  assert.doesNotMatch(workflow, /docker build|continue-on-error/);
});

test("il deploy VPS preserva lock, dati, rollback e confini condivisi", () => {
  const deploy = read("scripts/vps/deploy-release.sh");

  assert.match(deploy, /hub-fatture-sequent-docker\.lock/);
  assert.match(deploy, /fail\(\) \{[^}]*return 1[^}]*\}/);
  assert.doesNotMatch(deploy, /fail\(\) \{[^}]*exit 1[^}]*\}/);
  assert.match(deploy, /SEQUENT_DEPLOY_MAX_DISK_PERCENT:-79/);
  assert.match(deploy, /SEQUENT_RELEASE_RETENTION_COUNT:-2/);
  assert.match(
    deploy,
    /required_bytes=\$\(\(2 \* archive_bytes \+ 2 \* data_bytes \+ safety_bytes\)\)/,
  );
  assert.match(deploy, /available_bytes >= required_bytes/);
  assert.match(deploy, /release-artifact\.mjs" verify/);
  assert.match(deploy, /migration-\$commit/);
  assert.match(deploy, /source\.backup\(destination\)/);
  assert.match(deploy, /PRAGMA quick_check/);
  assert.match(deploy, /PRAGMA foreign_key_check/);
  assert.match(deploy, /status IN \('queued', 'running'\)/);
  assert.match(deploy, /rsync --archive --delete "\$snapshot\/data\/" "\$root\/data\/"/);
  assert.match(deploy, /trap 'handle_signal 129' HUP/);
  assert.match(deploy, /trap 'handle_signal 130' INT/);
  assert.match(deploy, /trap 'handle_signal 143' TERM/);
  assert.match(deploy, /snapshot_started.*rm -rf --one-file-system "\$snapshot"/s);
  assert.match(deploy, /up --detach --no-build --force-recreate/);
  assert.match(deploy, /\.deployment-maintenance/);
  assert.match(deploy, /\$SEQUENT_ORIGIN\/api\/health/);
  assert.match(deploy, /public_identity\[1\].*\$commit/);
  assert.match(deploy, /prune_old_directories "\$root\/releases"/);
  assert.match(deploy, /prune_old_directories "\$root\/snapshots"/);
  assert.match(deploy, /sequent-production-deployment\/v1/);
  assert.match(deploy, /sequent-docker-prune\.timer/);
  assert.doesNotMatch(deploy, /docker (?:image )?prune|docker build|\bcaddy\b|\bdynu\b|\bufw\b/i);
});

test("la manutenzione Docker protegge anche un runtime selezionato per image ID", () => {
  const prune = read("scripts/vps/prune-docker-images.sh");

  assert.match(prune, /current_ref.*sha256:\[0-9a-f\]\{64\}/s);
});

test("l'health pubblico espone l'identità exact-commit dell'immagine", () => {
  const health = read("src/routes/api/health/+server.ts");

  assert.match(health, /commit: process\.env\.SEQUENT_COMMIT_SHA/);
});
