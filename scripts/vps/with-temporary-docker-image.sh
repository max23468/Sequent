#!/usr/bin/env bash
set -euo pipefail

image="${1:-}"
[[ "$image" =~ ^sequent:tmp-[a-z0-9][a-z0-9._-]*$ ]] \
  || { echo "Uso: with-temporary-docker-image.sh sequent:tmp-<nome> -- <comando>" >&2; exit 2; }
shift
[[ "${1:-}" == -- ]] || { echo "Separatore -- mancante" >&2; exit 2; }
shift
(($#)) || { echo "Comando temporaneo assente" >&2; exit 2; }

root="${SEQUENT_ROOT:-/opt/sequent}"
shared_lock="${SHARED_DOCKER_LOCK:-/run/lock/hub-fatture-sequent-docker.lock}"
maximum_disk_percent="${SEQUENT_BUILD_MAX_DISK_PERCENT:-79}"
image_revision="${SEQUENT_IMAGE_REVISION:-}"
[[ "$maximum_disk_percent" =~ ^[0-9]+$ && "$maximum_disk_percent" -ge 1 \
  && "$maximum_disk_percent" -le 99 ]] \
  || { echo "Soglia disco build non valida" >&2; exit 2; }

cleanup() {
  local command_status=$?
  local cleanup_status=0
  local layer
  trap - EXIT HUP INT TERM
  while read -r container; do
    [[ -n "$container" ]] || continue
    docker rm --force "$container" >/dev/null || cleanup_status=1
  done < <(docker ps -aq --filter "ancestor=$image")
  if docker image inspect "$image" >/dev/null 2>&1; then
    docker image rm "$image" >/dev/null || cleanup_status=1
  fi
  while read -r layer; do
    [[ -n "$layer" ]] || continue
    grep -Fqx "$layer" <<<"$dangling_before" && continue
    docker image rm "$layer" >/dev/null || cleanup_status=1
  done < <(docker image ls --no-trunc --filter dangling=true -q | sort -u)
  if ((command_status != 0)); then exit "$command_status"; fi
  exit "$cleanup_status"
}

exec 9>"$shared_lock"
flock -n 9 || { echo "Una build, un deploy o una manutenzione Docker è già in corso" >&2; exit 1; }

disk_use="$(df -P "$root" | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')"
((disk_use <= maximum_disk_percent)) \
  || { echo "Build rifiutata: disco al ${disk_use}% (massimo ${maximum_disk_percent}%)" >&2; exit 1; }
docker image inspect "$image" >/dev/null 2>&1 \
  && { echo "Tag temporaneo già esistente: $image" >&2; exit 1; }
if [[ -z "$image_revision" ]]; then
  image_revision="$(git -C "$root/repo" rev-parse HEAD)" \
    || { echo "Revisione del checkout non rilevabile" >&2; exit 1; }
fi
[[ "$image_revision" =~ ^[0-9a-f]{40}$ ]] \
  || { echo "Revisione immagine non valida" >&2; exit 1; }

dangling_before="$(docker image ls --no-trunc --filter dangling=true -q | sort -u)"
trap cleanup EXIT HUP INT TERM
export SEQUENT_TEMP_IMAGE="$image"
export SEQUENT_IMAGE_REVISION="$image_revision"
"$@"
