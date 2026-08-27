import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const revision = "a".repeat(40);
const currentTag = `sequent:m3-${revision.slice(0, 12)}`;
const imageId = (character: string) => `sha256:${character.repeat(64)}`;

test("la build locale conserva solo tag correnti e protegge immagini in uso", () => {
  const root = mkdtempSync(path.join(tmpdir(), "sequent-local-image-"));
  const bin = path.join(root, "bin");
  const lock = path.join(root, "locks");
  const events = path.join(root, "events");
  const built = path.join(root, "built");
  const currentId = imageId("1");
  const oldId = imageId("2");
  const runningId = imageId("3");
  const danglingId = imageId("4");
  mkdirSync(bin, { recursive: true });
  mkdirSync(lock, { recursive: true });

  writeFileSync(
    path.join(bin, "git"),
    `#!/usr/bin/env bash
if [[ "$*" == *'rev-parse HEAD'* ]]; then printf '%s\n' '${revision}'; exit 0; fi
if [[ "$*" == *'diff --quiet'* || "$*" == *'diff --cached --quiet'* ]]; then exit 0; fi
if [[ "$*" == *'ls-files --others --exclude-standard'* ]]; then exit 0; fi
echo "Comando Git inatteso: $*" >&2
exit 1
`,
  );
  writeFileSync(
    path.join(bin, "df"),
    "#!/bin/sh\nprintf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\nfake 100 50 50 50%% /\\n'\n",
  );
  writeFileSync(
    path.join(bin, "docker"),
    `#!/usr/bin/env bash
set -euo pipefail
events='${events}'
built='${built}'
current_id='${currentId}'
old_id='${oldId}'
running_id='${runningId}'
dangling_id='${danglingId}'
if [[ "$1" == info ]]; then exit 0; fi
if [[ "$1" == build ]]; then printf 'build:%s\n' "$*" >> "$events"; : > "$built"; exit 0; fi
if [[ "$1 $2" == 'ps -aq' ]]; then printf '%s\n' running-container; exit 0; fi
if [[ "$1" == inspect && "$2" == --format ]]; then printf '%s\n' "$running_id"; exit 0; fi
if [[ "$1 $2" == 'image inspect' && "$3" == --format ]]; then
  case "$5" in
    sequent:m3-old) printf '%s\n' "$old_id" ;;
    sequent:m3-running) printf '%s\n' "$running_id" ;;
    *) printf '%s\n' "$current_id" ;;
  esac
  exit 0
fi
if [[ "$1 $2" == 'image ls' ]]; then
  if [[ " $* " == *' dangling=true '* ]]; then printf '%s\n' "$dangling_id"; exit 0; fi
  printf '%s\n' sequent:m3-local '${currentTag}' sequent:m3-old sequent:m3-running
  exit 0
fi
if [[ "$1 $2" == 'image rm' ]]; then printf 'remove:%s\n' "$3" >> "$events"; exit 0; fi
if [[ "$1 $2" == 'context show' ]]; then printf '%s\n' colima; exit 0; fi
echo "Comando Docker inatteso: $*" >&2
exit 1
`,
  );
  writeFileSync(
    path.join(bin, "colima"),
    `#!/bin/sh
printf 'trim:%s\n' "$*" >> '${events}'
`,
  );
  for (const command of ["git", "df", "docker", "colima"]) {
    chmodSync(path.join(bin, command), 0o755);
  }

  try {
    execFileSync("bash", ["scripts/local/build-docker-image.sh"], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        TMPDIR: lock,
      },
    });
    const output = readFileSync(events, "utf8");
    assert.match(output, /--platform linux\/arm64/);
    assert.match(output, /--tag sequent:m3-local/);
    assert.match(output, new RegExp(`--tag ${currentTag}`));
    assert.match(output, /remove:sequent:m3-old/);
    assert.match(output, new RegExp(`remove:${danglingId}`));
    assert.doesNotMatch(output, /remove:sequent:m3-running/);
    assert.match(output, /trim:ssh -- sudo fstrim -av/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("la build locale viene rifiutata prima di Docker con disco oltre soglia", () => {
  const root = mkdtempSync(path.join(tmpdir(), "sequent-local-disk-"));
  const bin = path.join(root, "bin");
  const lock = path.join(root, "locks");
  const dockerCalled = path.join(root, "docker-called");
  mkdirSync(bin, { recursive: true });
  mkdirSync(lock, { recursive: true });
  writeFileSync(
    path.join(bin, "df"),
    "#!/bin/sh\nprintf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\nfake 100 90 10 90%% /\\n'\n",
  );
  writeFileSync(path.join(bin, "docker"), `#!/bin/sh\n: > '${dockerCalled}'\nexit 0\n`);
  chmodSync(path.join(bin, "df"), 0o755);
  chmodSync(path.join(bin, "docker"), 0o755);

  try {
    assert.throws(() =>
      execFileSync("bash", ["scripts/local/build-docker-image.sh"], {
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          TMPDIR: lock,
          SEQUENT_LOCAL_BUILD_MAX_DISK_PERCENT: "85",
        },
        stdio: "pipe",
      }),
    );
    assert.throws(() => readFileSync(dockerCalled));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
