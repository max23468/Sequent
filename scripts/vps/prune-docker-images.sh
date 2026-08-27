#!/usr/bin/env bash
set -euo pipefail

mode=apply
minimum_age_hours="${SEQUENT_IMAGE_MINIMUM_AGE_HOURS:-24}"
dangling_age_hours="${SEQUENT_DANGLING_MINIMUM_AGE_HOURS:-24}"
while (($#)); do
  case "$1" in
    --dry-run) mode=dry-run ;;
    --minimum-age-hours) shift; minimum_age_hours="${1:-}" ;;
    --dangling-age-hours) shift; dangling_age_hours="${1:-}" ;;
    *) echo "Uso: prune-docker-images.sh [--dry-run] [--minimum-age-hours N] [--dangling-age-hours N]" >&2; exit 2 ;;
  esac
  shift
done
[[ "$minimum_age_hours" =~ ^[0-9]+$ && "$dangling_age_hours" =~ ^[0-9]+$ ]] \
  || { echo "Le età minime devono essere numeri interi non negativi" >&2; exit 2; }

root="${SEQUENT_ROOT:-/opt/sequent}"
shared_lock="${SHARED_DOCKER_LOCK:-/run/lock/hub-fatture-sequent-docker.lock}"
repository_source=https://github.com/max23468/Sequent

read_current_image() {
  awk -F= '
    $1 == "SEQUENT_IMAGE" { count += 1; value = $2 }
    END { if (count != 1) exit 1; print value }
  ' "$root/runtime/runtime.env"
}

is_protected() {
  local candidate="$1"
  [[ "$candidate" == "$current_id" || ( -n "$rollback_id" && "$candidate" == "$rollback_id" ) ]] \
    || grep -Fqx "$candidate" <<<"$running_ids" \
    || grep -Fqx "$candidate" <<<"$retained_ids"
}

is_sequent_image() {
  local candidate="$1"
  local source tags
  docker image inspect "$candidate" >/dev/null 2>&1 || return 1
  source="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.source"}}' \
    "$candidate" 2>/dev/null)" || return 1
  [[ "$source" == "$repository_source" ]] && return 0
  tags="$(docker image inspect --format '{{range .RepoTags}}{{println .}}{{end}}' \
    "$candidate" 2>/dev/null)" || return 1
  grep -Eq '^sequent:' <<<"$tags"
}

old_enough() {
  local image_id="$1"
  local hours="$2"
  local created created_epoch now
  ((hours == 0)) && return 0
  created="$(docker image inspect --format '{{.Created}}' "$image_id")"
  created_epoch="$(date -d "$created" +%s)" \
    || { echo "Timestamp immagine non interpretabile: $image_id" >&2; return 1; }
  now="$(date +%s)"
  ((created_epoch <= now && now - created_epoch >= hours * 3600))
}

remove_image() {
  local image_id="$1"
  local kind="$2"
  if [[ "$mode" == dry-run ]]; then
    printf 'Rimuoverebbe %s %s\n' "$kind" "$image_id"
  elif [[ "$kind" == dangling ]]; then
    docker image rm "$image_id" >/dev/null 2>&1 \
      || { printf 'Preservata dipendenza Docker %s\n' "$image_id" >&2; return 0; }
  else
    docker image rm "$image_id" >/dev/null
  fi
  removed=$((removed + 1))
}

[[ -f "$root/runtime/runtime.env" ]] || { echo "Configurazione runtime assente" >&2; exit 1; }
[[ -d "$root/releases" ]] || { echo "Registro release assente" >&2; exit 1; }

exec 9>"$shared_lock"
flock -n 9 || { echo "Una build, un deploy o una manutenzione Docker è già in corso" >&2; exit 1; }

current_ref="$(read_current_image)" || { echo "Immagine runtime non univoca" >&2; exit 1; }
[[ "$current_ref" =~ ^sequent:[0-9a-f]{40}$ \
  || "$current_ref" =~ ^sequent-release:[0-9a-f]{40}$ \
  || "$current_ref" =~ ^([a-z0-9.-]+(:[0-9]+)?/)?[a-z0-9._/-]+@sha256:[0-9a-f]{64}$ ]] \
  || { echo "Riferimento runtime Sequent non valido" >&2; exit 1; }
current_id="$(docker image inspect --format '{{.Id}}' "$current_ref")" \
  || { echo "Immagine runtime protetta assente" >&2; exit 1; }

retained_ids=
retained_file="$root/runtime/retained-image-ids"
if [[ -f "$retained_file" ]]; then
  while IFS= read -r candidate || [[ -n "$candidate" ]]; do
    candidate="${candidate%$'\r'}"
    [[ -n "$candidate" ]] || continue
    [[ "$candidate" =~ ^sha256:[0-9a-f]{64}$ ]] \
      || { echo "Image ID trattenuto non valido: $retained_file" >&2; exit 1; }
    docker image inspect "$candidate" >/dev/null 2>&1 \
      || { echo "Immagine trattenuta assente: $candidate" >&2; exit 1; }
    retained_ids="${retained_ids}${retained_ids:+$'\n'}${candidate}"
  done <"$retained_file"
fi

rollback_id=
metadata_paths="$(find "$root/releases" -mindepth 2 -maxdepth 2 -type f -name image-id -print)"
if [[ -n "$metadata_paths" ]]; then
  for metadata in $(printf '%s\n' "$metadata_paths" | xargs ls -1t); do
    candidate="$(tr -d '\r\n' <"$metadata")"
    [[ "$candidate" =~ ^sha256:[0-9a-f]{64}$ ]] \
      || { echo "Image ID release non valido: $metadata" >&2; exit 1; }
    [[ "$candidate" == "$current_id" ]] && continue
    grep -Fqx "$candidate" <<<"$retained_ids" && continue
    docker image inspect "$candidate" >/dev/null 2>&1 || continue
    rollback_id="$candidate"
    break
  done
fi
[[ -n "$rollback_id" ]] || { echo "Immagine rollback Sequent assente" >&2; exit 1; }

running_ids=
for container in $(docker ps -aq); do
  container_image="$(docker inspect --format '{{.Image}}' "$container")"
  running_ids="${running_ids}${running_ids:+$'\n'}${container_image}"
done

removed=0
for image_id in $(docker image ls --no-trunc -aq | sort -u); do
  is_sequent_image "$image_id" || continue
  is_protected "$image_id" && continue
  old_enough "$image_id" "$minimum_age_hours" || continue
  remove_image "$image_id" sequent
done

for image_id in $(docker image ls --no-trunc --filter dangling=true -q | sort -u); do
  docker image inspect "$image_id" >/dev/null 2>&1 || continue
  is_sequent_image "$image_id" || continue
  is_protected "$image_id" && continue
  old_enough "$image_id" "$dangling_age_hours" || continue
  remove_image "$image_id" dangling
done

docker image inspect "$current_ref" "$rollback_id" >/dev/null
while read -r retained_id; do
  [[ -n "$retained_id" ]] || continue
  docker image inspect "$retained_id" >/dev/null
done <<<"$retained_ids"
usage="$(df -P "$root" | awk 'NR == 2 { print $5 }')"
printf 'Pulizia immagini Sequent: modalità=%s candidate=%s uso-disco=%s\n' \
  "$mode" "$removed" "$usage"
