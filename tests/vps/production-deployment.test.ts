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
  assert.match(workflow, /sudo \/usr\/local\/sbin\/sequent-run-trusted-deploy --commit/);
  assert.doesNotMatch(workflow, /sudo \/opt\/sequent\/repo\/scripts/);
  assert.doesNotMatch(workflow, /docker build|continue-on-error/);
});

test("il deploy VPS preserva lock, dati, rollback e confini condivisi", () => {
  const deploy = read("scripts/vps/deploy-release.sh");

  assert.match(deploy, /hub-fatture-sequent-docker\.lock/);
  assert.match(deploy, /SEQUENT_TRUSTED_REPOSITORY/);
  assert.match(deploy, /sequent-deploy-source/);
  assert.match(deploy, /sorgente trusted del deploy non root-owned/);
  assert.match(deploy, /fail\(\) \{[^}]*return 1[^}]*\}/);
  assert.doesNotMatch(deploy, /fail\(\) \{[^}]*exit 1[^}]*\}/);
  assert.match(deploy, /load_runtime_env\(\)/);
  assert.match(deploy, /chiave runtime non ammessa/);
  assert.match(deploy, /mktemp \/run\/sequent-runtime-env\./);
  assert.match(deploy, /chown root:root "\$trusted_runtime_env"/);
  assert.match(deploy, /--env-file "\$trusted_runtime_env"/);
  assert.doesNotMatch(deploy, /source "\$runtime_env"/);
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
  assert.match(deploy, /if ! public_identity_output=/);
  assert.match(deploy, /health pubblico non interpretabile/);
  assert.match(deploy, /public_identity\[@\].*-eq 2/);
  assert.doesNotMatch(deploy, /readarray -t public_identity < <\(/);
  assert.match(deploy, /public_identity\[1\].*\$commit/);
  assert.match(deploy, /prune_old_directories "\$root\/releases"/);
  assert.match(deploy, /prune_old_directories "\$root\/snapshots"/);
  assert.match(deploy, /sequent-production-deployment\/v1/);
  assert.match(deploy, /sequent-docker-prune\.timer/);
  assert.doesNotMatch(deploy, /docker (?:image )?prune|docker build|\bcaddy\b|\bdynu\b|\bufw\b/i);
});

test("il launcher root-owned esegue soltanto il tree Git exact-commit", () => {
  const launcher = read("scripts/vps/run-trusted-deploy.sh");

  assert.match(launcher, /export PATH=\/usr\/sbin:\/usr\/bin:\/sbin:\/bin/);
  assert.match(launcher, /git -C "\$repository" rev-parse HEAD/);
  assert.match(launcher, /git -C "\$repository" diff --quiet/);
  assert.match(launcher, /git -C "\$repository" archive --format=tar "\$commit"/);
  assert.match(launcher, /mktemp -d \/run\/sequent-deploy-source\./);
  assert.match(launcher, /chown -R root:root "\$trusted_source"/);
  assert.match(launcher, /SEQUENT_TRUSTED_REPOSITORY="\$trusted_source"/);
  assert.doesNotMatch(launcher, /source |eval |docker build/);
});

test("la manutenzione Docker protegge anche un runtime selezionato per image ID", () => {
  const prune = read("scripts/vps/prune-docker-images.sh");

  assert.match(prune, /current_ref.*sha256:\[0-9a-f\]\{64\}/s);
});

test("l'health pubblico espone l'identità exact-commit dell'immagine", () => {
  const health = read("src/routes/api/health/+server.ts");

  assert.match(health, /commit: process\.env\.SEQUENT_COMMIT_SHA/);
});
