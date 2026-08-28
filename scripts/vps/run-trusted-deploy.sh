#!/usr/bin/env bash
set -euo pipefail

export PATH=/usr/sbin:/usr/bin:/sbin:/bin

root="${SEQUENT_ROOT:-/opt/sequent}"
repository="$root/repo"
commit=
arguments=("$@")

while (($#)); do
  if [[ "$1" == --commit ]]; then
    shift
    commit="${1:-}"
    break
  fi
  shift
done

[[ "$(id -u)" -eq 0 ]] || { echo "ERRORE: il launcher richiede root" >&2; exit 1; }
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || { echo "ERRORE: commit non valido" >&2; exit 1; }
[[ -d "$repository/.git" || -f "$repository/.git" ]] || {
  echo "ERRORE: checkout Sequent assente" >&2
  exit 1
}
[[ "$(/usr/bin/git -C "$repository" rev-parse HEAD)" == "$commit" ]] || {
  echo "ERRORE: checkout non exact-commit" >&2
  exit 1
}
/usr/bin/git -C "$repository" diff --quiet
/usr/bin/git -C "$repository" diff --cached --quiet

trusted_source="$(mktemp -d /run/sequent-deploy-source.XXXXXX)"
cleanup() {
  if [[ "$trusted_source" == /run/sequent-deploy-source.* ]]; then
    rm -rf --one-file-system "$trusted_source"
  fi
}
trap cleanup EXIT HUP INT TERM

/usr/bin/git -C "$repository" archive --format=tar "$commit" |
  /usr/bin/tar --extract --directory "$trusted_source" --no-same-owner --no-same-permissions
/bin/chown -R root:root "$trusted_source"
/bin/chmod -R go-w "$trusted_source"
deploy_script="$trusted_source/scripts/vps/deploy-release.sh"
[[ -f "$deploy_script" && ! -L "$deploy_script" && -x "$deploy_script" ]] || {
  echo "ERRORE: deploy exact-commit non eseguibile" >&2
  exit 1
}

SEQUENT_TRUSTED_REPOSITORY="$trusted_source" \
  SEQUENT_CHECKOUT_REPOSITORY="$repository" \
  "$deploy_script" "${arguments[@]}"
