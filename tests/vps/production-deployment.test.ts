import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("Production distribuisce soltanto una candidata ARM64 exact-run", () => {
  const workflow = read(".github/workflows/production.yml");

  assert.match(workflow, /^name: Production$/m);
  assert.match(workflow, /^run-name: Production \$\{\{ inputs\.commit \}\}$/m);
  assert.doesNotMatch(workflow, /^run-name:.*release_run/m);
  assert.match(workflow, /permissions:\n  actions: read\n  contents: read\n  deployments: write/);
  assert.match(workflow, /environment: Production/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /test .*\.head_sha.*CANDIDATE_COMMIT/);
  assert.match(workflow, /test .*\.conclusion.*success/);
  assert.match(workflow, /\.github\/workflows\/release-candidate\.yml/);
  assert.match(workflow, /actions\/download-artifact@[0-9a-f]{40} # v8\.0\.1/);
  assert.match(workflow, /run-id: \$\{\{ inputs\.release_run \}\}/);
  assert.match(workflow, /release-artifact\.mjs verify/);
  assert.match(workflow, /candidate_tree=.*git rev-parse.*CANDIDATE_COMMIT.*\^\{tree\}/);
  assert.match(workflow, /--commit "\$CANDIDATE_COMMIT"/);
  assert.match(workflow, /--tree "\$candidate_tree"/);
  assert.match(workflow, /archive_sha256=.*sha256sum/);
  assert.match(workflow, /manifest_sha256=.*sha256sum/);
  assert.match(workflow, /--archive-sha256 '\$archive_sha256'/);
  assert.match(workflow, /--manifest-sha256 '\$manifest_sha256'/);
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
  assert.match(deploy, /artefatto fuori dalla sorgente trusted/);
  assert.match(deploy, /root:root:600/);
  assert.match(deploy, /chown root:ubuntu "\$root\/runtime"/);
  assert.match(deploy, /directory runtime non protetta/);
  assert.match(deploy, /root:ubuntu:750/);
  assert.ok(
    deploy.indexOf('repository="${SEQUENT_TRUSTED_REPOSITORY:-}"') <
      deploy.indexOf('for input in "$archive" "$manifest"'),
  );
  assert.match(deploy, /mktemp \/run\/sequent-rollback-compose\./);
  assert.match(deploy, /show "\$previous_commit:deploy\/compose\.example\.yml"/);
  assert.match(deploy, /chown root:root "\$rollback_compose_file"/);
  assert.match(deploy, /rollback_compose\[@\].*up --detach --no-build --force-recreate/s);
  assert.doesNotMatch(deploy, /--file "\$runtime_compose"/);
  assert.match(deploy, /fail\(\) \{[^}]*return 1[^}]*\}/);
  assert.doesNotMatch(deploy, /fail\(\) \{[^}]*exit 1[^}]*\}/);
  assert.match(deploy, /load_runtime_env\(\)/);
  assert.match(deploy, /chiave runtime non ammessa/);
  assert.match(deploy, /id -u sequent-runtime/);
  assert.match(deploy, /id -g sequent-runtime/);
  assert.match(deploy, /SEQUENT_RUNTIME_UID.*runtime_uid/);
  assert.match(deploy, /SEQUENT_RUNTIME_GID.*runtime_gid/);
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
  assert.match(deploy, /--commit "\$commit" --tree "\$candidate_tree"/);
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
  assert.match(deploy, /mktemp -d "\$root\/snapshots\/\.migration-\$commit\.XXXXXX"/);
  assert.match(
    deploy,
    /mktemp -d "\$root\/snapshots\/\$deployment_stamp-\$previous_commit\.XXXXXX"/,
  );
  assert.doesNotMatch(deploy, /\$root\/tmp\/migration-/);
  assert.match(deploy, /stat -c '%U:%G:%a' "\$root\/releases".*root:root:750/s);
  assert.match(deploy, /stat -c '%U:%G:%a' "\$root\/snapshots".*root:root:700/s);
  assert.match(deploy, /install -d -o root -g root -m 0750 "\$release_dir"/);
  assert.match(deploy, /up --detach --no-build --force-recreate/);
  assert.match(deploy, /\.deployment-maintenance/);
  assert.match(deploy, /\$SEQUENT_ORIGIN\/api\/health/);
  assert.match(deploy, /if ! public_identity_output=/);
  assert.match(deploy, /rollback non healthy; manutenzione mantenuta/);
  assert.match(deploy, /health pubblico non interpretabile/);
  assert.match(deploy, /public_identity\[@\].*-eq 2/);
  assert.doesNotMatch(deploy, /readarray -t public_identity < <\(/);
  assert.match(deploy, /public_identity\[1\].*\$commit/);
  assert.match(deploy, /prune_old_directories "\$root\/releases"/);
  assert.match(deploy, /prune_old_directories "\$root\/snapshots"/);
  assert.match(deploy, /sequent-production-deployment\/v1/);
  assert.match(deploy, /sequent-docker-prune\.timer/);
  assert.match(deploy, /stat -c '%U:%G:%a' \/usr\/local\/sbin.*root:root:755/);
  assert.match(
    deploy,
    /install -o root -g root -m 0755 "\$repository\/scripts\/vps\/prune-docker-images\.sh"[\s\S]*?\/usr\/local\/sbin\/sequent-prune-docker-images/,
  );
  assert.doesNotMatch(deploy, /\$root\/runtime\/prune-docker-images\.sh/);
  assert.doesNotMatch(deploy, /docker (?:image )?prune|docker build|\bcaddy\b|\bdynu\b|\bufw\b/i);

  const previousImage = deploy.indexOf(
    'previous_image_id="$(docker inspect --format \'{{.Image}}\' "$current_container")"',
  );
  const immutableRollbackEnv = deploy.indexOf(
    'write_trusted_runtime_env "$previous_runtime_image"',
    previousImage,
  );
  const artifactLoad = deploy.indexOf('release-artifact.mjs" verify', immutableRollbackEnv);
  assert.ok(
    previousImage >= 0 &&
      previousImage < immutableRollbackEnv &&
      immutableRollbackEnv < artifactLoad,
  );

  const maintenance = deploy.indexOf(
    'install -o "$runtime_uid" -g "$runtime_gid" -m 0600 /dev/null "$maintenance_marker"',
  );
  const frozenJobCheck = deploy.indexOf(
    '[[ -f "$database" ]] && check_database "$database"',
    maintenance,
  );
  const migration = deploy.indexOf(
    'migration_copy="$(mktemp -d "$root/snapshots/.migration-$commit.XXXXXX")"',
  );
  const shutdown = deploy.indexOf('"${candidate_compose[@]}" down --remove-orphans', maintenance);
  const snapshot = deploy.indexOf('snapshot="$(mktemp -d', shutdown);
  assert.ok(
    maintenance >= 0 &&
      maintenance < frozenJobCheck &&
      frozenJobCheck < migration &&
      migration < shutdown &&
      shutdown < snapshot,
  );
});

test("il launcher root-owned esegue soltanto il tree Git exact-commit", () => {
  const launcher = read("scripts/vps/run-trusted-deploy.sh");

  assert.match(launcher, /export PATH=\/usr\/sbin:\/usr\/bin:\/sbin:\/bin/);
  assert.match(launcher, /\/usr\/sbin\/runuser --user ubuntu -- \/usr\/bin\/env -i/);
  assert.match(launcher, /GIT_CONFIG_NOSYSTEM=1/);
  assert.match(launcher, /GIT_CONFIG_GLOBAL=\/dev\/null/);
  assert.match(launcher, /git_as_checkout_owner rev-parse HEAD/);
  assert.match(launcher, /git_as_checkout_owner diff --quiet/);
  assert.match(launcher, /git_as_checkout_owner archive --format=tar "\$commit"/);
  assert.equal(launcher.match(/\/usr\/bin\/git -C/g)?.length, 1);
  assert.match(launcher, /mktemp -d \/run\/sequent-deploy-source\./);
  assert.match(launcher, /--archive-sha256/);
  assert.match(launcher, /--manifest-sha256/);
  assert.match(launcher, /sha256sum "\$trusted_archive"/);
  assert.match(launcher, /sha256sum "\$trusted_manifest"/);
  assert.match(launcher, /install -o root -g root -m 0600 "\$archive" "\$trusted_archive"/);
  assert.match(launcher, /chown -R root:root "\$trusted_source"/);
  assert.match(launcher, /SEQUENT_TRUSTED_REPOSITORY="\$trusted_source"/);
  assert.doesNotMatch(launcher, /source |eval |docker build/);
});

test("il deploy trusted non esegue Git come root", () => {
  const deploy = read("scripts/vps/deploy-release.sh");

  assert.match(deploy, /\/usr\/sbin\/runuser --user ubuntu -- \/usr\/bin\/env -i/);
  assert.match(deploy, /git_as_checkout_owner rev-parse HEAD/);
  assert.match(deploy, /git_as_checkout_owner diff --quiet/);
  assert.match(
    deploy,
    /git_as_checkout_owner show "\$previous_commit:deploy\/compose\.example\.yml"/,
  );
  assert.match(deploy, /git_as_checkout_owner rev-parse 'HEAD\^\{tree\}'/);
  assert.equal(deploy.match(/\/usr\/bin\/git -C/g)?.length, 1);
  assert.doesNotMatch(deploy, /^\s*git -C/m);
  const artifact = read("scripts/github/release-artifact.mjs");
  const verify = artifact.slice(artifact.indexOf("async function verify"));
  assert.match(verify, /commit: value\(args, "--commit"\)/);
  assert.match(verify, /tree: value\(args, "--tree"\)/);
  assert.doesNotMatch(verify, /output\("git"/);
});

test("la manutenzione Docker protegge anche un runtime selezionato per image ID", () => {
  const prune = read("scripts/vps/prune-docker-images.sh");

  assert.match(prune, /current_ref.*sha256:\[0-9a-f\]\{64\}/s);
});

test("l'health pubblico espone l'identità exact-commit dell'immagine", () => {
  const health = read("src/routes/api/health/+server.ts");

  assert.match(health, /commit: process\.env\.SEQUENT_COMMIT_SHA/);
});
