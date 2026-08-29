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
  assert.match(preflight, /assert_layout \. root:root:755/);
  assert.match(preflight, /assert_layout runtime root:ubuntu:750/);
  assert.match(preflight, /assert_layout releases root:root:750/);
  assert.match(preflight, /assert_layout snapshots root:root:700/);
});

test("il runbook non include utente, hostname o endpoint amministrativi reali", () => {
  const runbook = read("docs/runbooks/vps.md");

  assert.doesNotMatch(runbook, /accesso amministrativo:[^\n]*\b(?:come|tramite)\b/);
  assert.match(runbook, /comando locale `sequent-ssh`/);
  assert.match(runbook, /\.config\/sequent\/local-vps\.env/);
  assert.match(runbook, /preflight\.env/);
});

test("le build VPS sono confinate dal wrapper con lock, soglia disco e pulizia", () => {
  const wrapper = read("scripts/vps/with-temporary-docker-image.sh");
  const cleanup = read("scripts/vps/prune-docker-images.sh");
  const runbook = read("docs/runbooks/vps.md");
  const dockerfile = read("Dockerfile");
  const ci = read(".github/workflows/ci.yml");
  const release = read(".github/workflows/release-candidate.yml");
  const service = read("deploy/systemd/sequent-docker-prune.service");
  const timer = read("deploy/systemd/sequent-docker-prune.timer");

  assert.match(wrapper, /hub-fatture-sequent-docker\.lock/);
  assert.match(wrapper, /SEQUENT_BUILD_MAX_DISK_PERCENT:-79/);
  assert.match(wrapper, /dangling_before/);
  assert.match(wrapper, /docker image ls --no-trunc --filter dangling=true -q/);
  assert.doesNotMatch(wrapper, /docker image prune/);
  assert.match(wrapper, /SEQUENT_IMAGE_REVISION/);
  assert.match(cleanup, /SEQUENT_IMAGE/);
  assert.match(cleanup, /sequent-release:/);
  assert.match(cleanup, /@sha256:/);
  assert.match(cleanup, /image-id/);
  assert.match(cleanup, /retained-image-ids/);
  assert.match(cleanup, /\^sequent:/);
  assert.match(cleanup, /is_sequent_image "\$image_id" \|\| continue/);
  assert.match(cleanup, /is_protected/);
  assert.match(runbook, /with-temporary-docker-image\.sh/);
  assert.match(runbook, /finestra di sicurezza predefinita di 24 ore/);
  assert.match(
    dockerfile,
    /org\.opencontainers\.image\.source="https:\/\/github\.com\/max23468\/Sequent"/,
  );
  assert.match(dockerfile, /org\.opencontainers\.image\.revision=\$APP_COMMIT_SHA/);
  assert.match(ci, /--build-arg APP_COMMIT_SHA=\$\{\{ github\.sha \}\}/);
  assert.match(release, /--build-arg APP_COMMIT_SHA=\$\{\{ inputs\.commit \}\}/);
  assert.match(service, /ExecStart=\/usr\/local\/sbin\/sequent-prune-docker-images/);
  assert.doesNotMatch(service, /ExecStart=\/opt\/sequent\/runtime\//);
  assert.match(service, /ProtectSystem=strict/);
  assert.match(timer, /OnCalendar=daily/);
  assert.match(timer, /Persistent=true/);
});

test("le azioni cache e artifact usano linee basate su Node 24", () => {
  const ci = read(".github/workflows/ci.yml");
  const release = read(".github/workflows/release-candidate.yml");

  assert.match(ci, /actions\/cache@[0-9a-f]{40} # v(?:[6-9]|\d{2,})\./);
  assert.match(release, /actions\/upload-artifact@[0-9a-f]{40} # v(?:[7-9]|\d{2,})\./);
  assert.equal(
    release.match(/actions\/download-artifact@[0-9a-f]{40} # v(?:[8-9]|\d{2,})\./g)?.length,
    2,
  );
});

test("il runtime dietro Caddy dichiara origine HTTPS e singolo proxy fidato", () => {
  const compose = read("deploy/compose.example.yml");
  const dockerfile = read("Dockerfile");
  const runbook = read("docs/runbooks/vps.md");
  const release = read(".github/workflows/release-candidate.yml");

  assert.match(compose, /ORIGIN: \$\{SEQUENT_ORIGIN:\?[^}]+\}/);
  assert.match(compose, /ADDRESS_HEADER: X-Forwarded-For/);
  assert.match(compose, /XFF_DEPTH: "1"/);
  assert.match(compose, /127\.0\.0\.1:3300:3000/);
  assert.match(compose, /networks:\s*\n\s*- sequent\s*\n\s*- sequent-proxy/);
  assert.match(compose, /sequent-proxy:\s*\n\s*name: sequent-proxy\s*\n\s*external: true/);
  assert.doesNotMatch(compose, /hub-fatture|frontend/);
  assert.match(
    compose,
    /\/tmp:size=256m,mode=1777,uid=\$\{SEQUENT_RUNTIME_UID:\?[^}]+\},gid=\$\{SEQUENT_RUNTIME_GID:\?[^}]+\}/,
  );
  assert.match(compose, /no-new-privileges:true/);
  assert.doesNotMatch(compose, /apparmor=unconfined|seccomp=unconfined/);
  assert.match(compose, /cap_drop:\s*\n\s*- ALL/);
  assert.doesNotMatch(compose, /cap_add:|SYS_ADMIN|NET_ADMIN|SETUID/);
  assert.match(dockerfile, /ca-certificates/);
  assert.match(dockerfile, /^FROM node:26\.7\.0-trixie-slim@sha256:[0-9a-f]{64} AS node-base$/m);
  assert.match(dockerfile, /COPY requirements-ocr\.txt/);
  assert.match(dockerfile, /COPY --from=ocr --chown=root:root \/opt\/ocr \/opt\/ocr/);
  assert.match(dockerfile, /python3 -m venv \/opt\/ocr/);
  assert.match(dockerfile, /COPY --from=build --chown=root:root \/app\/node_modules/);
  assert.match(dockerfile, /find \/ -xdev -type f -perm \/6000 -exec chmod a-s/);
  assert.doesNotMatch(dockerfile, /codex-launcher|4755/);
  assert.match(dockerfile, /test -z "\$\(find \/ -xdev -type f -perm \/6000 -print -quit\)"/);
  assert.match(dockerfile, /'X-Forwarded-For':'127\.0\.0\.1'/);
  assert.match(release, /scripts\/local\/verify-docker-runtime\.sh/);
  assert.match(runbook, /SEQUENT_ORIGIN/);
  assert.match(runbook, /tmpfs.*stessi UID e GID.*1777/);
  assert.match(runbook, /profilo Production qualificato finché Codex è spento/);
  assert.match(runbook, /futura attivazione di Codex richiede un profilo runtime separato/);
  assert.match(runbook, /sovrascrivere gli header inoltrati dal client/);
  assert.match(runbook, /unico hop davanti a Sequent/);
  assert.match(runbook, /rete esterna dedicata `sequent-proxy`/);
  assert.match(
    runbook,
    /Caddy è l'unico container collegato sia alla propria rete frontend sia a `sequent-proxy`/,
  );
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
