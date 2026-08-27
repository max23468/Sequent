#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
canonical_image=sequent:m3-local
retention_label=io.sequent.local.retention
maximum_disk_percent="${SEQUENT_LOCAL_BUILD_MAX_DISK_PERCENT:-85}"

[[ "$maximum_disk_percent" =~ ^[0-9]+$ && "$maximum_disk_percent" -ge 1 \
  && "$maximum_disk_percent" -le 99 ]] \
  || { echo "Soglia disco locale non valida" >&2; exit 2; }

lock_parent="${TMPDIR:-/tmp}"
lock_directory="${lock_parent%/}/sequent-local-docker-image.lock"
mkdir "$lock_directory" 2>/dev/null \
  || { echo "Una build Docker locale Sequent è già in corso" >&2; exit 1; }
trap 'rmdir "$lock_directory"' EXIT HUP INT TERM

disk_use="$(df -P "$repository_root" | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')"
[[ "$disk_use" =~ ^[0-9]+$ ]] || { echo "Uso disco locale non rilevabile" >&2; exit 1; }
((disk_use <= maximum_disk_percent)) \
  || { echo "Build rifiutata: disco al ${disk_use}% (massimo ${maximum_disk_percent}%)" >&2; exit 1; }

revision="$(git -C "$repository_root" rev-parse HEAD)"
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] \
  || { echo "Revisione Git locale non valida" >&2; exit 1; }

dirty=false
git -C "$repository_root" diff --quiet || dirty=true
git -C "$repository_root" diff --cached --quiet || dirty=true
[[ -z "$(git -C "$repository_root" ls-files --others --exclude-standard)" ]] || dirty=true

versioned_image="sequent:m3-${revision:0:12}"
[[ "$dirty" == false ]] || versioned_image="${versioned_image}-dirty"

docker info >/dev/null
docker build \
  --platform linux/arm64 \
  --build-arg "APP_COMMIT_SHA=$revision" \
  --label org.opencontainers.image.source=https://github.com/max23468/Sequent \
  --label "org.opencontainers.image.revision=$revision" \
  --label "$retention_label=managed" \
  --tag "$canonical_image" \
  --tag "$versioned_image" \
  "$repository_root"

running_image_ids=
while IFS= read -r container; do
  [[ -n "$container" ]] || continue
  image_id="$(docker inspect --format '{{.Image}}' "$container")"
  running_image_ids="${running_image_ids}${running_image_ids:+$'\n'}${image_id}"
done < <(docker ps -aq)

is_in_use() {
  local image_id="$1"
  [[ -n "$running_image_ids" ]] && grep -Fqx "$image_id" <<<"$running_image_ids"
}

removed=0
while IFS= read -r image; do
  [[ -n "$image" && "$image" != *':<none>' ]] || continue
  [[ "$image" == "$canonical_image" || "$image" == "$versioned_image" ]] && continue
  image_id="$(docker image inspect --format '{{.Id}}' "$image")"
  is_in_use "$image_id" && continue
  docker image rm "$image" >/dev/null
  removed=$((removed + 1))
done < <(
  {
    docker image ls --format '{{.Repository}}:{{.Tag}}' --filter "label=$retention_label=managed"
    docker image ls --format '{{.Repository}}:{{.Tag}}' --filter 'reference=sequent:m3-*'
  } | sort -u
)

current_id="$(docker image inspect --format '{{.Id}}' "$canonical_image")"
while IFS= read -r image_id; do
  [[ -n "$image_id" && "$image_id" != "$current_id" ]] || continue
  is_in_use "$image_id" && continue
  docker image rm "$image_id" >/dev/null
  removed=$((removed + 1))
done < <(
  docker image ls --no-trunc -q \
    --filter dangling=true \
    --filter "label=$retention_label=managed" | sort -u
)

if command -v colima >/dev/null 2>&1 && [[ "$(docker context show)" == colima ]]; then
  colima ssh -- sudo fstrim -av >/dev/null \
    || echo "Avviso: TRIM Colima non riuscito; la build resta valida" >&2
fi

printf 'Immagine locale pronta: canonica=%s revisione=%s rimosse=%s uso-disco=%s%%\n' \
  "$canonical_image" "$versioned_image" "$removed" "$disk_use"
