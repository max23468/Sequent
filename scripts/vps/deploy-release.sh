#!/usr/bin/env bash
set -euo pipefail

root="${SEQUENT_ROOT:-/opt/sequent}"
shared_lock="${SHARED_DOCKER_LOCK:-/run/lock/hub-fatture-sequent-docker.lock}"
max_disk_percent="${SEQUENT_DEPLOY_MAX_DISK_PERCENT:-79}"
retention_count="${SEQUENT_RELEASE_RETENTION_COUNT:-2}"
commit=
archive=
manifest=

while (($#)); do
  case "$1" in
    --commit) shift; commit="${1:-}" ;;
    --archive) shift; archive="${1:-}" ;;
    --manifest) shift; manifest="${1:-}" ;;
    *) echo "Uso: deploy-release.sh --commit SHA --archive FILE --manifest FILE" >&2; exit 2 ;;
  esac
  shift
done

fail() {
  echo "ERRORE: $*" >&2
  return 1
}

[[ "$(id -u)" -eq 0 ]] || fail "il deploy richiede privilegi amministrativi"
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || fail "commit non valido"
[[ "$max_disk_percent" =~ ^[0-9]+$ ]] || fail "soglia disco non valida"
((max_disk_percent < 100)) || fail "soglia disco non valida"
[[ "$retention_count" =~ ^[0-9]+$ ]] || fail "retention release non valida"
((retention_count >= 2)) || fail "la retention deve preservare almeno runtime e rollback"

for input in "$archive" "$manifest"; do
  [[ "$input" == "$root/tmp/"* ]] || fail "artefatto fuori dalla directory temporanea"
  [[ -f "$input" && ! -L "$input" ]] || fail "artefatto assente o non regolare"
done

runtime_env="$root/runtime/runtime.env"
runtime_compose="$root/runtime/compose.yml"
repository="$root/repo"
database="$root/data/sequent.sqlite"
trusted_runtime_env=
previous_runtime_image=

load_runtime_env() {
  local input="$1"
  local line key value
  local image_seen=false uid_seen=false gid_seen=false origin_seen=false

  SEQUENT_IMAGE=
  SEQUENT_RUNTIME_UID=
  SEQUENT_RUNTIME_GID=
  SEQUENT_ORIGIN=
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -n "$line" && "$line" == *=* ]] || fail "riga della configurazione runtime non valida"
    key="${line%%=*}"
    value="${line#*=}"
    case "$key" in
      SEQUENT_IMAGE)
        [[ "$image_seen" == false ]] || fail "chiave runtime duplicata: $key"
        image_seen=true
        SEQUENT_IMAGE="$value"
        ;;
      SEQUENT_RUNTIME_UID)
        [[ "$uid_seen" == false ]] || fail "chiave runtime duplicata: $key"
        uid_seen=true
        SEQUENT_RUNTIME_UID="$value"
        ;;
      SEQUENT_RUNTIME_GID)
        [[ "$gid_seen" == false ]] || fail "chiave runtime duplicata: $key"
        gid_seen=true
        SEQUENT_RUNTIME_GID="$value"
        ;;
      SEQUENT_ORIGIN)
        [[ "$origin_seen" == false ]] || fail "chiave runtime duplicata: $key"
        origin_seen=true
        SEQUENT_ORIGIN="$value"
        ;;
      *) fail "chiave runtime non ammessa: $key" ;;
    esac
  done <"$input"

  [[ "$image_seen" == true && "$uid_seen" == true && "$gid_seen" == true \
    && "$origin_seen" == true ]] || fail "configurazione runtime incompleta"
  [[ "$SEQUENT_IMAGE" =~ ^sha256:[0-9a-f]{64}$ \
    || "$SEQUENT_IMAGE" =~ ^sequent(-release)?:[0-9a-f]{40}$ ]] ||
    fail "immagine runtime non valida"
  [[ "$SEQUENT_RUNTIME_UID" =~ ^[0-9]+$ ]] || fail "UID runtime non valido"
  [[ "$SEQUENT_RUNTIME_GID" =~ ^[0-9]+$ ]] || fail "GID runtime non valido"
  [[ "$SEQUENT_ORIGIN" =~ ^https://[^/]+$ ]] || fail "origine runtime non valida"
}

write_trusted_runtime_env() {
  local image="$1"
  printf 'SEQUENT_IMAGE=%s\nSEQUENT_RUNTIME_UID=%s\nSEQUENT_RUNTIME_GID=%s\nSEQUENT_ORIGIN=%s\n' \
    "$image" "$SEQUENT_RUNTIME_UID" "$SEQUENT_RUNTIME_GID" "$SEQUENT_ORIGIN" \
    >"$trusted_runtime_env"
  chown root:root "$trusted_runtime_env"
  chmod 0600 "$trusted_runtime_env"
}

cleanup_trusted_runtime_env() {
  if [[ "$trusted_runtime_env" == /run/sequent-runtime-env.* ]]; then
    rm -f "$trusted_runtime_env"
  fi
}

[[ -f "$runtime_env" && ! -L "$runtime_env" ]] || fail "configurazione runtime assente"
[[ -f "$runtime_compose" && ! -L "$runtime_compose" ]] || fail "Compose runtime assente"
[[ "$(stat -c '%U:%G:%a' "$runtime_env")" == "ubuntu:ubuntu:600" ]] ||
  fail "permessi della configurazione runtime non conformi"
[[ "$(stat -c '%U:%G:%a' "$runtime_compose")" == "ubuntu:ubuntu:640" ]] ||
  fail "permessi del Compose runtime non conformi"

load_runtime_env "$runtime_env"
previous_runtime_image="$SEQUENT_IMAGE"
trusted_runtime_env="$(mktemp /run/sequent-runtime-env.XXXXXX)"
write_trusted_runtime_env "$previous_runtime_image"
trap cleanup_trusted_runtime_env EXIT

exec 9>"$shared_lock"
flock -n 9 || fail "una build, un deploy o una manutenzione Docker è già in corso"

disk_percent="$(df -P "$root" | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')"
[[ "$disk_percent" =~ ^[0-9]+$ ]] || fail "utilizzo disco non interpretabile"
((disk_percent <= max_disk_percent)) || fail "utilizzo disco oltre la soglia di sicurezza"
available_bytes="$(df --output=avail --block-size=1 "$root" | awk 'NR == 2 { print $1 }')"
archive_bytes="$(stat -c '%s' "$archive")"
data_bytes="$(du --summarize --block-size=1 "$root/data" | awk '{ print $1 }')"
[[ "$available_bytes" =~ ^[0-9]+$ && "$archive_bytes" =~ ^[0-9]+$ && "$data_bytes" =~ ^[0-9]+$ ]] ||
  fail "stima dello spazio non interpretabile"
safety_bytes=$((2 * 1024 * 1024 * 1024))
required_bytes=$((2 * archive_bytes + 2 * data_bytes + safety_bytes))
((available_bytes >= required_bytes)) || fail "spazio insufficiente per artefatto, prove e rollback"

[[ "$(git -C "$repository" rev-parse HEAD)" == "$commit" ]] || fail "checkout non exact-commit"
git -C "$repository" diff --quiet || fail "checkout modificato"
git -C "$repository" diff --cached --quiet || fail "index modificato"
cd "$repository"

compose=(docker compose --project-name sequent --env-file "$trusted_runtime_env" --file "$runtime_compose")
current_container="$("${compose[@]}" ps --quiet sequent)"
[[ -n "$current_container" ]] || fail "runtime precedente assente"
[[ "$(docker inspect --format '{{.State.Health.Status}}' "$current_container")" == healthy ]] ||
  fail "runtime precedente non healthy"
previous_image_id="$(docker inspect --format '{{.Image}}' "$current_container")"
previous_commit="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$previous_image_id")"
[[ "$previous_commit" =~ ^[0-9a-f]{40}$ ]] || fail "commit precedente non leggibile"

check_database() {
  python3 - "$1" <<'PY'
import sqlite3
import sys

database = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
if database.execute("PRAGMA quick_check").fetchone()[0] != "ok":
    raise SystemExit("quick_check SQLite fallito")
if database.execute("PRAGMA foreign_key_check").fetchone() is not None:
    raise SystemExit("foreign_key_check SQLite fallito")
tables = {row[0] for row in database.execute("SELECT name FROM sqlite_master WHERE type='table'")}
if "jobs" in tables:
    active = database.execute("SELECT count(*) FROM jobs WHERE status IN ('queued', 'running')").fetchone()[0]
    if active:
        raise SystemExit("job attivi impediscono il deploy")
PY
}

[[ -f "$database" ]] && check_database "$database"

SEQUENT_NODE_SLOT=current "$repository/scripts/vps/with-node.sh" node \
  "$repository/scripts/github/release-artifact.mjs" verify \
  --archive "$archive" --manifest "$manifest"

readarray -t artifact_identity < <(SEQUENT_NODE_SLOT=current "$repository/scripts/vps/with-node.sh" node - "$manifest" <<'NODE'
const manifest = require(process.argv[2]);
for (const value of [manifest.schema, manifest.commit, manifest.tree, manifest.platform,
  manifest.imageTag, manifest.imageId, manifest.archive?.name, manifest.archive?.sha256]) {
  console.log(value ?? "");
}
NODE
)
[[ "${artifact_identity[0]}" == "sequent-release-artifact/v1" ]] || fail "schema manifest non valido"
[[ "${artifact_identity[1]}" == "$commit" ]] || fail "commit manifest divergente"
[[ "${artifact_identity[2]}" == "$(git -C "$repository" rev-parse 'HEAD^{tree}')" ]] ||
  fail "tree manifest divergente"
[[ "${artifact_identity[3]}" == "linux/arm64" ]] || fail "piattaforma manifest divergente"
[[ "${artifact_identity[4]}" == "sequent-release:$commit" ]] || fail "tag manifest divergente"
candidate_image_id="${artifact_identity[5]}"
[[ "$candidate_image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "image ID candidato non valido"
[[ "$(docker image inspect --format '{{.Id}}' "$candidate_image_id")" == "$candidate_image_id" ]] ||
  fail "immagine candidata assente"
[[ "$(docker image inspect --format '{{.Architecture}}' "$candidate_image_id")" == arm64 ]] ||
  fail "immagine candidata non ARM64"
[[ "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$candidate_image_id")" == "$commit" ]] ||
  fail "label commit candidata divergente"

SEQUENT_IMAGE="$candidate_image_id" bash "$repository/scripts/local/verify-docker-runtime.sh"

deployment_stamp="$(date -u +%Y%m%dT%H%M%SZ)"
migration_copy="$root/tmp/migration-$commit-$$"
migration_container="sequent-migration-$commit-$$"
snapshot="$root/snapshots/$deployment_stamp-$previous_commit"
release_dir="$root/releases/$commit"
rollback_armed=false
snapshot_started=false
transaction_complete=false
release_was_present=false

cleanup() {
  docker rm --force "$migration_container" >/dev/null 2>&1 || true
  cleanup_trusted_runtime_env
  if [[ "$migration_copy" == "$root/tmp/migration-"* ]]; then
    rm -rf --one-file-system "$migration_copy"
  fi
  if [[ "$transaction_complete" == false && "$snapshot_started" == true \
    && "$rollback_armed" == false && "$snapshot" == "$root/snapshots/"* ]]; then
    rm -rf --one-file-system "$snapshot"
  fi
  if [[ "$transaction_complete" == false && "$release_was_present" == false \
    && "$release_dir" == "$root/releases/"* ]]; then
    rm -rf --one-file-system "$release_dir"
  fi
}

rollback() {
  status="${1:-$?}"
  trap - ERR HUP INT TERM
  if [[ "$rollback_armed" == true ]]; then
    echo "Deploy fallito: ripristino automatico dell'immagine precedente" >&2
    "${compose[@]}" down --remove-orphans >/dev/null 2>&1 || true
    rsync --archive --delete "$snapshot/data/" "$root/data/"
    install -o ubuntu -g ubuntu -m 0600 "$snapshot/runtime.env" "$runtime_env"
    install -o ubuntu -g ubuntu -m 0640 "$snapshot/compose.yml" "$runtime_compose"
    write_trusted_runtime_env "$previous_runtime_image"
    "${compose[@]}" up --detach --no-build --force-recreate
  fi
  cleanup
  exit "$status"
}

handle_signal() {
  rollback "$1"
}

prune_old_directories() {
  local parent="$1"
  local pattern="$2"
  local kept=0
  local directory basename
  while IFS= read -r directory; do
    basename="${directory##*/}"
    [[ "$basename" =~ $pattern ]] || continue
    kept=$((kept + 1))
    ((kept <= retention_count)) && continue
    [[ "$directory" == "$parent/"* ]] || return 1
    rm -rf --one-file-system "$directory"
  done < <(find "$parent" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' |
    sort -rn | cut -d' ' -f2-)
}
trap rollback ERR
trap 'handle_signal 129' HUP
trap 'handle_signal 130' INT
trap 'handle_signal 143' TERM
trap cleanup EXIT

install -d -o sequent-runtime -g sequent-runtime -m 0700 "$migration_copy"
rsync --archive --delete --exclude='sequent.sqlite' --exclude='sequent.sqlite-wal' \
  --exclude='sequent.sqlite-shm' "$root/data/" "$migration_copy/"
if [[ -f "$database" ]]; then
  python3 - "$database" "$migration_copy/sequent.sqlite" <<'PY'
import sqlite3
import sys

source = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
destination = sqlite3.connect(sys.argv[2])
source.backup(destination)
destination.close()
source.close()
PY
  chown "$SEQUENT_RUNTIME_UID:$SEQUENT_RUNTIME_GID" "$migration_copy/sequent.sqlite"
fi

docker run --detach --name "$migration_container" --network none --read-only \
  --user "$SEQUENT_RUNTIME_UID:$SEQUENT_RUNTIME_GID" --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --tmpfs "/tmp:rw,size=256m,mode=1777,uid=$SEQUENT_RUNTIME_UID,gid=$SEQUENT_RUNTIME_GID" \
  --mount "type=bind,src=$migration_copy,dst=/var/lib/sequent" \
  --env NODE_ENV=production --env SEQUENT_DATA_DIR=/var/lib/sequent \
  --env "ORIGIN=$SEQUENT_ORIGIN" "$candidate_image_id" >/dev/null
for _attempt in $(seq 1 60); do
  [[ "$(docker inspect --format '{{.State.Health.Status}}' "$migration_container")" == healthy ]] && break
  sleep 1
done
[[ "$(docker inspect --format '{{.State.Health.Status}}' "$migration_container")" == healthy ]] ||
  fail "migrazione isolata non healthy"
docker rm --force "$migration_container" >/dev/null
[[ -f "$migration_copy/sequent.sqlite" ]] && check_database "$migration_copy/sequent.sqlite"

install -d -o ubuntu -g ubuntu -m 0700 "$snapshot/data"
snapshot_started=true
install -o ubuntu -g ubuntu -m 0600 "$runtime_env" "$snapshot/runtime.env"
install -o ubuntu -g ubuntu -m 0640 "$runtime_compose" "$snapshot/compose.yml"
rsync --archive --delete --exclude='sequent.sqlite' --exclude='sequent.sqlite-wal' \
  --exclude='sequent.sqlite-shm' "$root/data/" "$snapshot/data/"
if [[ -f "$database" ]]; then
  python3 - "$database" "$snapshot/data/sequent.sqlite" <<'PY'
import sqlite3
import sys

source = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
destination = sqlite3.connect(sys.argv[2])
source.backup(destination)
destination.close()
source.close()
PY
  chown "$SEQUENT_RUNTIME_UID:$SEQUENT_RUNTIME_GID" "$snapshot/data/sequent.sqlite"
fi
rollback_armed=true
"${compose[@]}" down --remove-orphans
rsync --archive --delete "$root/data/" "$snapshot/data/"
[[ -f "$database" ]] && check_database "$database"
maintenance_marker="$root/data/.deployment-maintenance"
install -o "$SEQUENT_RUNTIME_UID" -g "$SEQUENT_RUNTIME_GID" -m 0600 /dev/null \
  "$maintenance_marker"

[[ ! -e "$release_dir" ]] || release_was_present=true
install -d -o ubuntu -g ubuntu -m 0750 "$release_dir"
install -o ubuntu -g ubuntu -m 0640 "$manifest" "$release_dir/release-manifest.json"
install -o ubuntu -g ubuntu -m 0640 "$archive" "$release_dir/sequent-release-arm64.tar"
previous_release_dir="$root/releases/$previous_commit"
install -d -o ubuntu -g ubuntu -m 0750 "$previous_release_dir"
printf '%s\n' "$previous_image_id" >"$previous_release_dir/image-id"
chown ubuntu:ubuntu "$previous_release_dir/image-id"
chmod 0640 "$previous_release_dir/image-id"
touch "$previous_release_dir"

install -o ubuntu -g ubuntu -m 0640 "$repository/deploy/compose.example.yml" "$runtime_compose"
runtime_env_next="$(mktemp "$root/runtime/runtime.env.next.XXXXXX")"
printf 'SEQUENT_IMAGE=%s\nSEQUENT_RUNTIME_UID=%s\nSEQUENT_RUNTIME_GID=%s\nSEQUENT_ORIGIN=%s\n' \
  "$candidate_image_id" "$SEQUENT_RUNTIME_UID" "$SEQUENT_RUNTIME_GID" "$SEQUENT_ORIGIN" >"$runtime_env_next"
chown ubuntu:ubuntu "$runtime_env_next"
chmod 0600 "$runtime_env_next"
mv "$runtime_env_next" "$runtime_env"
write_trusted_runtime_env "$candidate_image_id"

"${compose[@]}" config --quiet
install -o root -g root -m 0755 "$repository/scripts/vps/prune-docker-images.sh" \
  "$root/runtime/prune-docker-images.sh"
install -o root -g root -m 0644 "$repository/deploy/systemd/sequent-docker-prune.service" \
  /etc/systemd/system/sequent-docker-prune.service
install -o root -g root -m 0644 "$repository/deploy/systemd/sequent-docker-prune.timer" \
  /etc/systemd/system/sequent-docker-prune.timer
systemctl daemon-reload
systemctl enable --now sequent-docker-prune.timer >/dev/null

"${compose[@]}" up --detach --no-build --force-recreate
candidate_container="$("${compose[@]}" ps --quiet sequent)"
for _attempt in $(seq 1 60); do
  [[ "$(docker inspect --format '{{.State.Health.Status}}' "$candidate_container")" == healthy ]] && break
  sleep 1
done
[[ "$(docker inspect --format '{{.State.Health.Status}}' "$candidate_container")" == healthy ]] ||
  fail "runtime candidato non healthy"
curl --fail --silent --header 'X-Forwarded-For: 127.0.0.1' http://127.0.0.1:3300/api/health >/dev/null

[[ "$(docker inspect --format '{{.Image}}' "$candidate_container")" == "$candidate_image_id" ]] ||
  fail "image ID live divergente"
[[ "$(docker inspect --format '{{.Config.User}}' "$candidate_container")" == "$SEQUENT_RUNTIME_UID:$SEQUENT_RUNTIME_GID" ]] ||
  fail "utente live divergente"
[[ "$(docker inspect --format '{{.HostConfig.ReadonlyRootfs}}' "$candidate_container")" == true ]] ||
  fail "root filesystem live scrivibile"
[[ "$(docker inspect --format '{{json .HostConfig.CapDrop}}' "$candidate_container")" == '["ALL"]' ]] ||
  fail "capability drop live divergente"
[[ "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$candidate_container")" == sequent ]] ||
  fail "progetto Compose live divergente"
[[ -f "$database" ]] && check_database "$database"
public_health="$(curl --fail --silent --show-error --max-time 15 "$SEQUENT_ORIGIN/api/health")"
public_identity_output=
if ! public_identity_output="$(SEQUENT_NODE_SLOT=current \
  "$repository/scripts/vps/with-node.sh" node -e \
  'const input = JSON.parse(process.argv[1]); console.log(input.status ?? ""); console.log(input.commit ?? "")' \
  "$public_health")"; then
  fail "health pubblico non interpretabile"
fi
readarray -t public_identity <<<"$public_identity_output"
[[ "${#public_identity[@]}" -eq 2 ]] || fail "identità pubblica non conforme"
[[ "${public_identity[0]:-}" == ok ]] || fail "health pubblico non conforme"
[[ "${public_identity[1]:-}" == "$commit" ]] || fail "commit pubblico divergente"

printf '%s\n' "$candidate_image_id" >"$release_dir/image-id"
chown ubuntu:ubuntu "$release_dir/image-id"
chmod 0640 "$release_dir/image-id"
SEQUENT_NODE_SLOT=current "$repository/scripts/vps/with-node.sh" node - \
  "$release_dir/deployment.json" "$commit" "$candidate_image_id" "$previous_commit" \
  "$previous_image_id" "$deployment_stamp" <<'NODE'
const fs = require("node:fs");
const [output, commit, imageId, previousCommit, previousImageId, deployedAt] = process.argv.slice(2);
fs.writeFileSync(output, `${JSON.stringify({
  schema: "sequent-production-deployment/v1",
  commit,
  imageId,
  previousCommit,
  previousImageId,
  deployedAt,
}, null, 2)}\n`, { mode: 0o640 });
NODE
chown ubuntu:ubuntu "$release_dir/deployment.json"

rm "$maintenance_marker"
rollback_armed=false
transaction_complete=true
trap - ERR HUP INT TERM
prune_old_directories "$root/releases" '^[0-9a-f]{40}$' ||
  echo "Avviso: retention delle release non completata" >&2
prune_old_directories "$root/snapshots" '^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{40}$' ||
  echo "Avviso: retention degli snapshot non completata" >&2
echo "OK: release $commit distribuita e verificata"
