import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("Production distribuisce soltanto una candidata ARM64 exact-run", () => {
  const workflow = read(".github/workflows/production.yml");

  assert.match(workflow, /^name: Production$/m);
  assert.match(workflow, /^run-name: Production \$\{\{ inputs\.commit \}\}$/m);
  assert.doesNotMatch(workflow, /^run-name:.*release_run/m);
  assert.match(workflow, /permissions:\n  actions: read\n  contents: write\n  deployments: write/);
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
  assert.match(workflow, /manifest_sha256=.*sha256sum/);
  assert.match(workflow, /launcher_sha256=.*run-trusted-deploy\.sh/);
  assert.match(workflow, /--image-ref '\$image_ref'/);
  assert.match(workflow, /--docker-config '\$docker_config'/);
  assert.match(workflow, /--manifest-sha256 '\$manifest_sha256'/);
  assert.match(workflow, /task: "sequent-production"/);
  assert.match(workflow, /name: Crea e rilegge tag e GitHub Release/);
  assert.match(workflow, /release\.mjs --commit "\$CANDIDATE_COMMIT"/);
  assert.match(
    workflow,
    /printf '%s\\n' "\$deployment_id" >"\$RUNNER_TEMP\/sequent-deployment-id"/,
  );
  assert.match(workflow, /chmod 0600 "\$RUNNER_TEMP\/sequent-deployment-id"/);
  assert.match(workflow, /sudo \/usr\/local\/sbin\/sequent-run-trusted-deploy --commit/);
  assert.match(workflow, /install -o root -g root -m 0600.*run-trusted-deploy\.sh/);
  assert.match(workflow, /sha256sum --check --strict/);
  assert.match(workflow, /install -o root -g root -m 0755.*sequent-run-trusted-deploy/);
  assert.doesNotMatch(workflow, /name: Pulisce le immagini dopo il deploy/);
  assert.match(workflow, /SEQUENT_GHCR_USERNAME/);
  assert.match(workflow, /SEQUENT_GHCR_TOKEN/);
  assert.match(workflow, /docker login ghcr\.io.*--password-stdin/);
  assert.ok(
    workflow.indexOf("sha256sum --check --strict") <
      workflow.indexOf("sudo /usr/local/sbin/sequent-run-trusted-deploy --commit"),
  );
  assert.match(workflow, /name: Finalizza il tentativo di deployment/);
  assert.match(workflow, /JOB_STATUS: \$\{\{ job\.status \}\}/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /deployments\/\$deployment_id\/statuses/);
  assert.match(workflow, /success\|failure\|error\|inactive/);
  assert.match(workflow, /state: "failure"/);
  assert.match(workflow, /if \[\[ "\$JOB_STATUS" == cancelled \]\]/);
  assert.match(workflow, /::warning title=Pulizia dopo annullamento differita::/);
  const cancellationCleanup = workflow.indexOf('if [[ "$JOB_STATUS" == cancelled ]]');
  assert.ok(cancellationCleanup > workflow.indexOf("deployment_status success"));
  assert.match(
    workflow.slice(cancellationCleanup),
    /sudo \/usr\/local\/sbin\/sequent-prune-docker-images --minimum-age-hours 0 --dangling-age-hours 0/,
  );
  assert.doesNotMatch(workflow.slice(0, cancellationCleanup), /sequent-prune-docker-images/);
  assert.doesNotMatch(workflow, /sudo \/opt\/sequent\/repo\/scripts/);
  assert.doesNotMatch(workflow, /docker build|continue-on-error/);
});

test("il runbook qualifica la finalizzazione di un deploy annullato", () => {
  const runbook = read("docs/runbooks/vps.md");

  assert.match(runbook, /finalizzatore eseguito anche dopo un annullamento/);
  assert.match(runbook, /chiude come fallito un Deployment ancora pendente/);
  assert.match(runbook, /solo dopo che il deploy interrotto ha completato il proprio rollback/);
  assert.match(
    runbook,
    /runtime corrente, rollback, container e immagini trattenute restano protetti/,
  );
});

test("il deploy VPS preserva lock, dati, rollback e confini condivisi", () => {
  const deploy = read("scripts/vps/deploy-release.sh");
  assert.match(
    deploy,
    /install -o root -g root -m 0755 .*configure-runtime-features\.py.*sequent-configure-runtime-features/s,
  );

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
      deploy.indexOf('[[ "$manifest" == "$repository/"* ]]'),
  );
  assert.match(deploy, /mktemp \/run\/sequent-rollback-compose\./);
  assert.match(deploy, /show "\$previous_commit:deploy\/compose\.example\.yml"/);
  assert.match(deploy, /chown root:root "\$rollback_compose_file"/);
  assert.match(deploy, /rollback_compose\[@\].*up --detach --no-build --force-recreate/s);
  assert.doesNotMatch(deploy, /--file "\$runtime_compose"/);
  assert.match(deploy, /fail\(\) \{[^}]*return 1[^}]*\}/);
  assert.doesNotMatch(deploy, /fail\(\) \{[^}]*exit 1[^}]*\}/);
  assert.match(deploy, /load_runtime_env\(\)/);
  assert.match(deploy, /python3.*migrate-runtime-features\.py/s);
  assert.ok(
    deploy.indexOf("migrate-runtime-features.py") <
      deploy.indexOf('load_runtime_env "$runtime_env"'),
  );
  assert.doesNotMatch(deploy, /\/usr\/bin\/node/);
  assert.match(deploy, /chiave runtime non ammessa/);
  assert.match(deploy, /id -u sequent-runtime/);
  assert.match(deploy, /id -g sequent-runtime/);
  assert.match(deploy, /SEQUENT_RUNTIME_UID.*runtime_uid/);
  assert.match(deploy, /SEQUENT_RUNTIME_GID.*runtime_gid/);
  assert.match(deploy, /SEQUENT_CODEX_ENABLED.*== true.*SEQUENT_CODEX_ENABLED.*== false/s);
  assert.match(deploy, /SEQUENT_DIZ_ENABLED.*== true.*SEQUENT_DIZ_ENABLED.*== false/s);
  assert.match(deploy, /SEQUENT_CODEX_ENABLED=\$SEQUENT_CODEX_ENABLED/);
  assert.match(deploy, /SEQUENT_DIZ_ENABLED=\$SEQUENT_DIZ_ENABLED/);
  assert.match(deploy, /mktemp \/run\/sequent-runtime-env\./);
  assert.match(deploy, /chown root:root "\$trusted_runtime_env"/);
  assert.match(deploy, /--env-file "\$trusted_runtime_env"/);
  assert.doesNotMatch(deploy, /source "\$runtime_env"/);
  assert.match(deploy, /SEQUENT_DEPLOY_MAX_DISK_PERCENT:-79/);
  assert.match(deploy, /SEQUENT_RELEASE_RETENTION_COUNT:-2/);
  assert.match(deploy, /required_bytes=\$\(\(2 \* data_bytes \+ safety_bytes\)\)/);
  assert.match(deploy, /available_bytes >= required_bytes/);
  assert.match(deploy, /schema manifest non valido/);
  assert.match(deploy, /commit manifest divergente/);
  assert.match(deploy, /tree manifest divergente/);
  assert.match(deploy, /riferimento manifest divergente/);
  assert.match(deploy, /digest manifest divergente/);
  assert.match(deploy, /docker pull --platform linux\/arm64 "\$image_ref"/);
  assert.match(deploy, /candidate_image_id=.*docker image inspect.*\$image_ref/s);
  assert.match(deploy, /image ID runtime candidato non valido/);
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
  assert.match(deploy, /previous_release_layout=.*stat -c '%U:%G:%a'/);
  assert.match(deploy, /ubuntu:ubuntu:750/);
  assert.match(deploy, /chown root:root "\$previous_release_dir"/);
  assert.match(deploy, /migrazione della release precedente fallita/);
  assert.ok(
    deploy.indexOf('chown root:root "$previous_release_dir"') <
      deploy.indexOf('"${candidate_compose[@]}" down --remove-orphans'),
  );
  assert.match(deploy, /up --detach --no-build --force-recreate/);
  assert.match(deploy, /\.deployment-maintenance/);
  assert.match(deploy, /\$SEQUENT_ORIGIN\/api\/health/);
  assert.match(deploy, /if ! public_health_status=/);
  assert.match(deploy, /rollback non healthy; manutenzione mantenuta/);
  assert.match(deploy, /health pubblico non interpretabile/);
  assert.match(deploy, /set\(health\) != \{"status"\}/);
  assert.match(deploy, /public_health_status.*== ok/);
  assert.doesNotMatch(deploy, /public_identity|commit pubblico|image ID pubblico/);
  assert.match(deploy, /HostConfig\.CapAdd.*== null/);
  assert.match(deploy, /HostConfig\.SecurityOpt.*no-new-privileges:true/);
  assert.match(deploy, /AppArmorProfile.*!= unconfined/);
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
  const artifactLoad = deploy.indexOf(
    'docker pull --platform linux/arm64 "$image_ref"',
    immutableRollbackEnv,
  );
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
  assert.equal(launcher.match(/GIT_NO_REPLACE_OBJECTS=1/g)?.length, 2);
  assert.match(launcher, /git_as_checkout_owner rev-parse HEAD/);
  assert.match(launcher, /git_as_checkout_owner rev-parse "\$commit\^\{tree\}"/);
  assert.match(launcher, /git_as_checkout_owner diff --quiet/);
  assert.match(launcher, /git_as_tree_verifier archive --format=tar "\$commit"/);
  assert.match(launcher, /git_as_tree_verifier write-tree/);
  assert.match(launcher, /"\$extracted_tree" == "\$expected_tree"/);
  assert.match(launcher, /GIT_ALTERNATE_OBJECT_DIRECTORIES="\$object_directory"/);
  assert.match(launcher, /useradd --system --gid ubuntu --no-create-home/);
  assert.match(launcher, /--shell \/usr\/sbin\/nologin "\$verification_user"/);
  assert.match(launcher, /account di verifica Git non conforme/);
  assert.match(launcher, /object database Git non confinato/);
  assert.equal(launcher.match(/\/usr\/bin\/git -C/g)?.length, 1);
  assert.match(launcher, /mktemp -d \/run\/sequent-deploy-source\./);
  assert.match(launcher, /mktemp -d \/run\/sequent-deploy-verification\./);
  assert.match(launcher, /migrate_layout_directory "\$root" 750 755/);
  assert.match(launcher, /migrate_layout_directory "\$root\/releases" 750 750/);
  assert.match(launcher, /migrate_layout_directory "\$root\/snapshots" 700 700/);
  assert.match(launcher, /layout preesistente non qualificato/);
  assert.match(launcher, /--image-ref/);
  assert.match(launcher, /--docker-config/);
  assert.match(launcher, /--manifest-sha256/);
  assert.match(launcher, /sha256sum "\$trusted_manifest"/);
  assert.match(launcher, /configurazione registry non valida/);
  assert.match(launcher, /root:root:700/);
  assert.match(launcher, /root:root:600/);
  assert.match(launcher, /chown -R root:root "\$trusted_source"/);
  assert.match(
    launcher,
    /git_as_checkout_owner ls-tree "\$commit" -- scripts\/vps\/deploy-release\.sh/,
  );
  assert.match(launcher, /"\$deploy_mode" == 100755/);
  assert.match(launcher, /chmod 0755 "\$deploy_script"/);
  assert.match(launcher, /stat -c '%U:%G:%a' "\$deploy_script".*root:root:755/s);
  assert.doesNotMatch(launcher, /-x "\$deploy_script"/);
  assert.match(launcher, /\/bin\/bash "\$deploy_script" --commit/);
  assert.ok(
    launcher.indexOf('"$extracted_tree" == "$expected_tree"') <
      launcher.indexOf('chmod 0755 "$deploy_script"'),
  );
  assert.match(launcher, /SEQUENT_TRUSTED_REPOSITORY="\$trusted_source"/);
  assert.ok(
    launcher.indexOf('"$extracted_tree" == "$expected_tree"') <
      launcher.indexOf('/bin/bash "$deploy_script" --commit'),
  );
  assert.doesNotMatch(launcher, /source |eval |docker build/);
});

test("il deploy trusted non esegue Git come root", () => {
  const deploy = read("scripts/vps/deploy-release.sh");

  assert.match(deploy, /\/usr\/sbin\/runuser --user ubuntu -- \/usr\/bin\/env -i/);
  assert.equal(deploy.match(/GIT_NO_REPLACE_OBJECTS=1/g)?.length, 1);
  assert.match(deploy, /git_as_checkout_owner rev-parse HEAD/);
  assert.match(deploy, /git_as_checkout_owner diff --quiet/);
  assert.match(
    deploy,
    /git_as_checkout_owner show "\$previous_commit:deploy\/compose\.example\.yml"/,
  );
  assert.match(deploy, /git_as_checkout_owner rev-parse 'HEAD\^\{tree\}'/);
  assert.equal(deploy.match(/\/usr\/bin\/git -C/g)?.length, 1);
  assert.doesNotMatch(deploy, /^\s*git -C/m);
  assert.doesNotMatch(deploy, /with-node\.sh|SEQUENT_NODE_SLOT/);
  assert.match(deploy, /\/usr\/bin\/python3 - "\$manifest"/);
  assert.match(deploy, /docker pull --platform linux\/arm64 "\$image_ref"/);
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

test("l'health pubblico espone soltanto uno stato generico", () => {
  const health = read("src/routes/api/health/+server.ts");
  const storageHealth = read("src/lib/server/health.ts");
  const compose = read("deploy/compose.example.yml");

  assert.match(health, /json\(\{ status: healthy \? "ok" : "degraded" \}/);
  assert.doesNotMatch(health, /sqliteVersion|SEQUENT_COMMIT_SHA|SEQUENT_IMAGE_ID/);
  assert.match(health, /searchParams\.get\("scope"\) === "storage"/);
  assert.match(health, /isStorageHealthy\(storage\)/);
  assert.match(storageHealth, /MIN_HEALTHY_FREE_BYTES = 5n/);
  assert.match(storageHealth, /MAX_HEALTHY_DISK_USED_PERCENT = 90n/);
  assert.doesNotMatch(compose, /SEQUENT_IMAGE_ID/);
});
