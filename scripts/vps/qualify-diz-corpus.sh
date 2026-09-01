#!/usr/bin/env bash
set -euo pipefail

host_stage=$(mktemp -d /opt/sequent/tmp/diz-verify.XXXXXX)
container_stage=/tmp/$(basename "$host_stage")
web_container=

cleanup() {
  case "$container_stage" in
    /tmp/diz-verify.*)
      if [[ -n "$web_container" ]]; then
        sudo docker exec "$web_container" rm -rf -- "$container_stage" >/dev/null 2>&1 || true
      fi
      ;;
  esac
  case "$host_stage" in
    /opt/sequent/tmp/diz-verify.*) sudo rm -rf -- "$host_stage" ;;
  esac
}
trap cleanup EXIT HUP INT TERM

mapfile -t containers < <(
  sudo docker ps \
    --filter label=com.docker.compose.project=sequent \
    --filter label=com.docker.compose.service=sequent \
    --format '{{.Names}}'
)
[[ ${#containers[@]} -eq 1 ]] || {
  echo "CONTAINER_WEB_COUNT_INVALID:${#containers[@]}" >&2
  exit 1
}
web_container=${containers[0]}

mapfile -d '' files < <(
  sudo find /opt/sequent/private \
    -path /opt/sequent/private/codex -prune -o \
    -type f -iname '*.diz' -print0 | sort -z
)
[[ ${#files[@]} -eq 5 ]] || {
  echo "CORPUS_COUNT_INVALID:${#files[@]}" >&2
  exit 1
}

index=0
for source_file in "${files[@]}"; do
  index=$((index + 1))
  sudo install -m 0600 -- "$source_file" "$host_stage/corpus-$(printf '%02d' "$index").diz"
done

sudo tar -C "$host_stage" -cf - . \
  | sudo docker exec -i "$web_container" sh -c \
    "mkdir -m 0700 '$container_stage' && tar --no-same-owner -C '$container_stage' -xf -"

sudo docker exec "$web_container" npm run qualify:diz-corpus -- \
  --corpus "$container_stage" \
  --data-dir /var/lib/sequent \
  --output /var/lib/sequent/qualification/diz-corpus.json
