import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("l'immagine applicativa usa una sola base Debian 13 Slim fissata per digest", () => {
  const dockerfile = read("Dockerfile");
  const directBases = dockerfile.match(
    /^FROM node:26\.7\.0-trixie-slim@sha256:[0-9a-f]{64} AS node-base$/gm,
  );

  assert.equal(directBases?.length, 1);
  assert.equal(dockerfile.match(/node:26\.7\.0-trixie-slim@sha256:/g)?.length, 1);
  assert.match(dockerfile, /^FROM node-base AS dependencies$/m);
  assert.match(dockerfile, /^FROM node-base AS ocr$/m);
  assert.match(dockerfile, /^FROM node-base AS runtime$/m);
  assert.doesNotMatch(dockerfile, /\b(?:alpine|apk|musl|gcompat)\b/i);
  assert.match(dockerfile, /DEBIAN_SNAPSHOT=\d{8}T\d{6}Z/);
  assert.match(dockerfile, /snapshot\.debian\.org\/archive\/debian/);
  assert.match(dockerfile, /--no-install-recommends/);
  assert.match(dockerfile, /rm -rf \/var\/lib\/apt\/lists\/\*/);
  assert.doesNotMatch(dockerfile, /apt-get (?:dist-)?upgrade/);
  assert.match(dockerfile, /npm install --global npm@12\.0\.2/);
  assert.match(dockerfile, /SEQUENT_COMMIT_SHA=\$APP_COMMIT_SHA/);
  assert.match(dockerfile, /groupadd --gid 10001 sequent/);
  assert.match(dockerfile, /useradd --uid 10001 --gid 10001/);
  assert.match(dockerfile, /^USER 10001:10001$/m);
});

test("il runtime conserva i converter e separa gli strumenti di build", () => {
  const dockerfile = read("Dockerfile");
  const verifier = read("scripts/local/verify-docker-runtime.sh");

  for (const packageName of [
    "fonts-dejavu-core",
    "ghostscript",
    "icc-profiles-free",
    "imagemagick",
    "jbig2",
    "libcap2-bin",
    "libreoffice-calc-nogui",
    "libreoffice-core-nogui",
    "libreoffice-writer-nogui",
    "pngquant",
    "poppler-utils",
    "python3",
    "qpdf",
    "tesseract-ocr-ita",
    "unpaper",
    "unzip",
  ]) {
    assert.match(dockerfile, new RegExp(`\\b${packageName}\\b`));
  }
  assert.match(dockerfile, /FROM node-base AS dependencies[\s\S]*build-essential python3/);
  assert.doesNotMatch(
    dockerfile.match(/FROM node-base AS runtime[\s\S]*/)?.[0] ?? "",
    /build-essential/,
  );
  assert.match(verifier, /test -z .*find \/lib \/usr\/lib .*musl/);
  assert.match(verifier, /! dpkg-query -W gcompat/);
  assert.match(verifier, /for tool in cc c\+\+ gcc g\+\+ ld make/);
  assert.match(verifier, /find \/ -xdev -type f -perm \/6000/);
  assert.match(verifier, /getcap -r \/ 2>\/dev\/null/);
  assert.match(verifier, /find \/app\/node_modules\/@openai -writable/);
  assert.match(dockerfile, /find \/app\/node_modules\/@openai -perm \/022/);
});

test("l'immagine include tutti gli strumenti amministrativi dichiarati", () => {
  const dockerfile = read("Dockerfile");
  const verifier = read("scripts/local/verify-docker-runtime.sh");

  assert.match(
    dockerfile,
    /COPY --from=build --chown=root:root \/app\/scripts\/admin \.\/scripts\/admin/,
  );
  for (const script of [
    "backup",
    "qualify-codex-runtime",
    "qualify-diz-corpus",
    "reset-owner",
    "restore",
    "seed-synthetic",
  ]) {
    assert.match(verifier, new RegExp(`(?:^| )${script}(?: |;)`));
  }
});

test("Dependabot aggiorna settimanalmente il digest Docker senza auto-merge", () => {
  const dependabot = read(".github/dependabot.yml");

  assert.match(dependabot, /package-ecosystem: docker/);
  assert.match(
    dependabot,
    /package-ecosystem: docker[\s\S]*interval: weekly[\s\S]*day: monday[\s\S]*timezone: Europe\/Rome/,
  );
  assert.doesNotMatch(dependabot, /auto-merge|automerge/i);
});

test("runbook e candidata usano la stessa qualifica Debian ARM64", () => {
  const runbook = read("docs/runbooks/vps.md");
  const candidate = read(".github/workflows/release-candidate.yml");

  assert.match(runbook, /Debian 13 Slim/);
  assert.match(runbook, /snapshot APT/);
  assert.match(candidate, /--platform linux\/arm64/);
  assert.match(
    candidate,
    /SEQUENT_IMAGE="\$IMAGE_TAG" bash scripts\/local\/verify-docker-runtime\.sh/,
  );
  assert.match(candidate, /scan image --format vertical --archive/);
});
