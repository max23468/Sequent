#!/usr/bin/env bash
set -euo pipefail

export PATH=/usr/sbin:/usr/bin:/sbin:/bin

root="${SEQUENT_ROOT:-/opt/sequent}"
repository="$root/repo"
commit=
archive=
archive_sha256=
manifest=
manifest_sha256=

git_as_checkout_owner() {
  /usr/sbin/runuser --user ubuntu -- /usr/bin/env -i \
    HOME=/home/ubuntu \
    PATH=/usr/bin:/bin \
    GIT_CONFIG_NOSYSTEM=1 \
    GIT_CONFIG_GLOBAL=/dev/null \
    /usr/bin/git -C "$repository" "$@"
}

while (($#)); do
  case "$1" in
    --commit) shift; commit="${1:-}" ;;
    --archive) shift; archive="${1:-}" ;;
    --archive-sha256) shift; archive_sha256="${1:-}" ;;
    --manifest) shift; manifest="${1:-}" ;;
    --manifest-sha256) shift; manifest_sha256="${1:-}" ;;
    *) echo "ERRORE: argomento non ammesso" >&2; exit 2 ;;
  esac
  shift
done

[[ "$(id -u)" -eq 0 ]] || { echo "ERRORE: il launcher richiede root" >&2; exit 1; }
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || { echo "ERRORE: commit non valido" >&2; exit 1; }
[[ "$archive_sha256" =~ ^[0-9a-f]{64}$ ]] || { echo "ERRORE: SHA archivio non valido" >&2; exit 1; }
[[ "$manifest_sha256" =~ ^[0-9a-f]{64}$ ]] || { echo "ERRORE: SHA manifest non valido" >&2; exit 1; }
for input in "$archive" "$manifest"; do
  [[ "$input" == "$root/tmp/"* && -f "$input" && ! -L "$input" ]] || {
    echo "ERRORE: artefatto di ingresso non valido" >&2
    exit 1
  }
done
[[ -d "$repository/.git" || -f "$repository/.git" ]] || {
  echo "ERRORE: checkout Sequent assente" >&2
  exit 1
}
[[ "$(git_as_checkout_owner rev-parse HEAD)" == "$commit" ]] || {
  echo "ERRORE: checkout non exact-commit" >&2
  exit 1
}
git_as_checkout_owner diff --quiet
git_as_checkout_owner diff --cached --quiet

trusted_source="$(mktemp -d /run/sequent-deploy-source.XXXXXX)"
cleanup() {
  if [[ "$trusted_source" == /run/sequent-deploy-source.* ]]; then
    rm -rf --one-file-system "$trusted_source"
  fi
}
trap cleanup EXIT HUP INT TERM

git_as_checkout_owner archive --format=tar "$commit" |
  /usr/bin/tar --extract --directory "$trusted_source" --no-same-owner --no-same-permissions
/bin/chown -R root:root "$trusted_source"
/bin/chmod -R go-w "$trusted_source"
trusted_archive="$trusted_source/sequent-release-arm64.tar"
trusted_manifest="$trusted_source/release-manifest.json"
/usr/bin/install -o root -g root -m 0600 "$archive" "$trusted_archive"
/usr/bin/install -o root -g root -m 0600 "$manifest" "$trusted_manifest"
[[ "$(/usr/bin/sha256sum "$trusted_archive" | /usr/bin/cut -d' ' -f1)" == "$archive_sha256" ]] || {
  echo "ERRORE: SHA archivio divergente" >&2
  exit 1
}
[[ "$(/usr/bin/sha256sum "$trusted_manifest" | /usr/bin/cut -d' ' -f1)" == "$manifest_sha256" ]] || {
  echo "ERRORE: SHA manifest divergente" >&2
  exit 1
}
deploy_script="$trusted_source/scripts/vps/deploy-release.sh"
[[ -f "$deploy_script" && ! -L "$deploy_script" && -x "$deploy_script" ]] || {
  echo "ERRORE: deploy exact-commit non eseguibile" >&2
  exit 1
}

SEQUENT_TRUSTED_REPOSITORY="$trusted_source" \
  SEQUENT_CHECKOUT_REPOSITORY="$repository" \
  "$deploy_script" --commit "$commit" --archive "$trusted_archive" --manifest "$trusted_manifest"
