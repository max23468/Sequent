import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

test("la pulizia preserva runtime, rollback e container ed elimina residui Sequent", () => {
  const root = mkdtempSync(path.join(tmpdir(), "sequent-image-retention-"));
  const bin = path.join(root, "bin");
  const runtime = path.join(root, "runtime");
  const releases = path.join(root, "releases");
  const removals = path.join(root, "removed-images");
  const currentRef = `ghcr.io/max23468/sequent@${digest("a")}`;
  const currentId = digest("1");
  const rollbackId = digest("2");
  const runningId = digest("3");
  const staleId = digest("4");
  const oldReleaseId = digest("5");
  const danglingId = digest("6");
  const foreignId = digest("7");
  const retainedId = digest("8");
  const legacyTaggedId = digest("9");
  const foreignDanglingId = digest("a");

  mkdirSync(bin, { recursive: true });
  mkdirSync(runtime, { recursive: true });
  for (const release of ["current", "retained", "rollback", "old"]) {
    mkdirSync(path.join(releases, release), { recursive: true });
  }
  writeFileSync(path.join(runtime, "runtime.env"), `SEQUENT_IMAGE=${currentRef}\n`);
  writeFileSync(path.join(runtime, "retained-image-ids"), `${retainedId}\n`);
  writeFileSync(path.join(releases, "current", "image-id"), `${currentId}\n`);
  writeFileSync(path.join(releases, "retained", "image-id"), `${retainedId}\n`);
  writeFileSync(path.join(releases, "rollback", "image-id"), `${rollbackId}\n`);
  writeFileSync(path.join(releases, "old", "image-id"), `${oldReleaseId}\n`);
  const now = new Date();
  utimesSync(path.join(releases, "current", "image-id"), now, now);
  utimesSync(
    path.join(releases, "retained", "image-id"),
    new Date(now.getTime() - 500),
    new Date(now.getTime() - 500),
  );
  utimesSync(
    path.join(releases, "rollback", "image-id"),
    new Date(now.getTime() - 1_000),
    new Date(now.getTime() - 1_000),
  );
  utimesSync(
    path.join(releases, "old", "image-id"),
    new Date(now.getTime() - 2_000),
    new Date(now.getTime() - 2_000),
  );

  writeFileSync(
    path.join(bin, "docker"),
    `#!/usr/bin/env bash
set -euo pipefail
current_ref='${currentRef}'
current_id='${currentId}'
rollback_id='${rollbackId}'
running_id='${runningId}'
stale_id='${staleId}'
old_release_id='${oldReleaseId}'
dangling_id='${danglingId}'
foreign_id='${foreignId}'
retained_id='${retainedId}'
legacy_tagged_id='${legacyTaggedId}'
foreign_dangling_id='${foreignDanglingId}'
if [[ "$1 $2" == 'image inspect' ]]; then
  if [[ "\${3:-}" == --format ]]; then
    format=$4
    target=$5
    if [[ "$format" == *'.Id'* ]]; then printf '%s\\n' "$current_id"; exit 0; fi
    if [[ "$format" == *'Created'* ]]; then printf '%s\\n' '2020-01-01T00:00:00Z'; exit 0; fi
    if [[ "$format" == *'org.opencontainers.image.source'* ]]; then
      [[ "$target" == "$foreign_id" || "$target" == "$foreign_dangling_id" || "$target" == "$legacy_tagged_id" ]] || printf '%s\\n' 'https://github.com/max23468/Sequent'
      exit 0
    fi
    if [[ "$format" == *'.RepoTags'* ]]; then
      if [[ "$target" == "$legacy_tagged_id" ]]; then printf '%s\\n' 'sequent:legacy-build'; else printf '%s\\n' 'foreign:latest'; fi
      exit 0
    fi
  fi
  exit 0
fi
case "$1 $2" in
  'image ls')
    if [[ " $* " == *' dangling=true '* ]]; then printf '%s\\n' "$dangling_id" "$foreign_dangling_id"; else printf '%s\\n' "$current_id" "$rollback_id" "$running_id" "$retained_id" "$stale_id" "$old_release_id" "$legacy_tagged_id" "$foreign_id"; fi
    ;;
  'image rm') printf '%s\\n' "$3" >> '${removals}' ;;
  'ps -aq') printf '%s\\n' running-container ;;
  'inspect --format') printf '%s\\n' "$running_id" ;;
  *) echo "Comando Docker inatteso: $*" >&2; exit 1 ;;
esac
`,
  );
  writeFileSync(path.join(bin, "flock"), "#!/bin/sh\nexit 0\n");
  chmodSync(path.join(bin, "docker"), 0o755);
  chmodSync(path.join(bin, "flock"), 0o755);

  try {
    execFileSync(
      "bash",
      [
        "scripts/vps/prune-docker-images.sh",
        "--minimum-age-hours",
        "0",
        "--dangling-age-hours",
        "0",
      ],
      {
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          SEQUENT_ROOT: root,
          SHARED_DOCKER_LOCK: path.join(root, "shared.lock"),
        },
      },
    );
    assert.deepEqual(
      readFileSync(removals, "utf8").trim().split("\n").sort(),
      [danglingId, legacyTaggedId, oldReleaseId, staleId].sort(),
    );
    const script = readFileSync("scripts/vps/prune-docker-images.sh", "utf8");
    assert.match(script, /docker image ls --no-trunc -aq/);
    assert.match(script, /docker image ls --no-trunc --filter dangling=true -q/);
    assert.match(script, /retained-image-ids/);
    assert.match(script, /sequent-release:/);
    assert.doesNotMatch(readFileSync(removals, "utf8"), new RegExp(retainedId));
    assert.doesNotMatch(readFileSync(removals, "utf8"), new RegExp(foreignDanglingId));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("il wrapper rimuove tag, container e layer anche dopo il comando", () => {
  const root = mkdtempSync(path.join(tmpdir(), "sequent-temporary-image-"));
  const bin = path.join(root, "bin");
  const state = path.join(root, "state");
  const events = path.join(root, "events");
  const danglingBefore = digest("8");
  const danglingAfter = digest("9");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    path.join(bin, "docker"),
    `#!/usr/bin/env bash
set -euo pipefail
state='${state}'
events='${events}'
dangling_before='${danglingBefore}'
dangling_after='${danglingAfter}'
if [[ "$1 $2" == 'image inspect' ]]; then [[ -f "$state" ]]; exit; fi
case "$1 $2" in
  'image ls')
    printf '%s\\n' "$dangling_before"
    [[ -f "$state" ]] && printf '%s\\n' "$dangling_after"
    true
    ;;
  'ps -aq') [[ -f "$state" ]] && printf '%s\\n' temporary-container ;;
  'rm --force') printf 'container:%s\\n' "$3" >> "$events" ;;
  'image rm')
    printf 'image:%s\\n' "$3" >> "$events"
    ;;
  *) echo "Comando Docker inatteso: $*" >&2; exit 1 ;;
esac
`,
  );
  writeFileSync(
    path.join(bin, "build-temporary"),
    `#!/bin/sh
test "$SEQUENT_TEMP_IMAGE" = 'sequent:tmp-regression'
: > '${state}'
`,
  );
  writeFileSync(path.join(bin, "flock"), "#!/bin/sh\nexit 0\n");
  writeFileSync(
    path.join(bin, "df"),
    "#!/bin/sh\nprintf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\nfake 100 50 50 50%% /\\n'\n",
  );
  chmodSync(path.join(bin, "docker"), 0o755);
  chmodSync(path.join(bin, "build-temporary"), 0o755);
  chmodSync(path.join(bin, "df"), 0o755);
  chmodSync(path.join(bin, "flock"), 0o755);

  try {
    execFileSync(
      "bash",
      [
        "scripts/vps/with-temporary-docker-image.sh",
        "sequent:tmp-regression",
        "--",
        "build-temporary",
      ],
      {
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          SEQUENT_ROOT: root,
          SHARED_DOCKER_LOCK: path.join(root, "shared.lock"),
          SEQUENT_BUILD_MAX_DISK_PERCENT: "99",
          SEQUENT_IMAGE_REVISION: "a".repeat(40),
        },
      },
    );
    assert.equal(
      readFileSync(events, "utf8"),
      `container:temporary-container\nimage:sequent:tmp-regression\nimage:${danglingAfter}\n`,
    );
    assert.doesNotMatch(readFileSync(events, "utf8"), new RegExp(danglingBefore));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
