#!/usr/bin/env bash
set -euo pipefail

export PATH=/usr/sbin:/usr/bin:/sbin:/bin

root="${SEQUENT_ROOT:-/opt/sequent}"
repository="$root/repo"
commit=
image_ref=
docker_config=
manifest=
manifest_sha256=
verification_git=
verification_user=sequent-deploy
object_directory=

migrate_layout_directory() {
  local path="$1"
  local legacy_mode="$2"
  local current_mode="$3"
  local layout
  [[ -d "$path" && ! -L "$path" ]] || {
    echo "ERRORE: directory del layout assente o non regolare" >&2
    exit 1
  }
  layout="$(/usr/bin/stat -c '%U:%G:%a' "$path")"
  [[ "$layout" == "ubuntu:ubuntu:$legacy_mode" || "$layout" == "root:root:$current_mode" ]] || {
    echo "ERRORE: layout preesistente non qualificato" >&2
    exit 1
  }
  /bin/chown root:root "$path"
  /bin/chmod "$current_mode" "$path"
  [[ "$(/usr/bin/stat -c '%U:%G:%a' "$path")" == "root:root:$current_mode" ]] || {
    echo "ERRORE: migrazione amministrativa del layout fallita" >&2
    exit 1
  }
}

git_as_checkout_owner() {
  /usr/sbin/runuser --user ubuntu -- /usr/bin/env -i \
    HOME=/home/ubuntu \
    PATH=/usr/bin:/bin \
    GIT_CONFIG_NOSYSTEM=1 \
    GIT_CONFIG_GLOBAL=/dev/null \
    GIT_NO_REPLACE_OBJECTS=1 \
    /usr/bin/git -C "$repository" "$@"
}

git_as_tree_verifier() {
  /usr/sbin/runuser --user "$verification_user" -- /usr/bin/env -i \
    HOME=/nonexistent \
    PATH=/usr/bin:/bin \
    GIT_CONFIG_NOSYSTEM=1 \
    GIT_CONFIG_GLOBAL=/dev/null \
    GIT_NO_REPLACE_OBJECTS=1 \
    GIT_ALTERNATE_OBJECT_DIRECTORIES="$object_directory" \
    /usr/bin/git --git-dir="$verification_git" --work-tree="$trusted_source" "$@"
}

while (($#)); do
  case "$1" in
    --commit) shift; commit="${1:-}" ;;
    --image-ref) shift; image_ref="${1:-}" ;;
    --docker-config) shift; docker_config="${1:-}" ;;
    --manifest) shift; manifest="${1:-}" ;;
    --manifest-sha256) shift; manifest_sha256="${1:-}" ;;
    *) echo "ERRORE: argomento non ammesso" >&2; exit 2 ;;
  esac
  shift
done

[[ "$(id -u)" -eq 0 ]] || { echo "ERRORE: il launcher richiede root" >&2; exit 1; }
[[ "$root" == /opt/sequent ]] || { echo "ERRORE: radice Sequent non canonica" >&2; exit 1; }
if ! /usr/bin/getent passwd "$verification_user" >/dev/null; then
  /usr/sbin/useradd --system --gid ubuntu --no-create-home \
    --home-dir /nonexistent --shell /usr/sbin/nologin "$verification_user"
fi
verification_passwd="$(/usr/bin/getent passwd "$verification_user")"
IFS=: read -r _ _ verification_uid _ _ verification_home verification_shell <<<"$verification_passwd"
[[ "$verification_uid" =~ ^[0-9]+$ && "$verification_uid" -lt 1000 &&
  "$verification_home" == /nonexistent && "$verification_shell" == /usr/sbin/nologin &&
  "$(/usr/bin/id -gn "$verification_user")" == ubuntu ]] || {
  echo "ERRORE: account di verifica Git non conforme" >&2
  exit 1
}
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || { echo "ERRORE: commit non valido" >&2; exit 1; }
[[ "$image_ref" =~ ^ghcr\.io/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$ ]] || {
  echo "ERRORE: riferimento immagine non valido" >&2
  exit 1
}
[[ "$manifest_sha256" =~ ^[0-9a-f]{64}$ ]] || { echo "ERRORE: SHA manifest non valido" >&2; exit 1; }
[[ "$manifest" == "$root/tmp/"* && -f "$manifest" && ! -L "$manifest" ]] || {
  echo "ERRORE: artefatto di ingresso non valido" >&2
  exit 1
}
[[ "$docker_config" == /run/sequent-ghcr-* && -d "$docker_config" && ! -L "$docker_config" ]] || {
  echo "ERRORE: configurazione registry non valida" >&2
  exit 1
}
[[ "$(/usr/bin/stat -c '%U:%G:%a' "$docker_config")" == root:root:700 ]] || {
  echo "ERRORE: permessi configurazione registry non conformi" >&2
  exit 1
}
[[ -f "$docker_config/config.json" && ! -L "$docker_config/config.json" \
  && "$(/usr/bin/stat -c '%U:%G:%a' "$docker_config/config.json")" == root:root:600 ]] || {
  echo "ERRORE: credenziale registry non conforme" >&2
  exit 1
}
migrate_layout_directory "$root" 750 755
migrate_layout_directory "$root/releases" 750 750
migrate_layout_directory "$root/snapshots" 700 700
[[ -d "$repository/.git" || -f "$repository/.git" ]] || {
  echo "ERRORE: checkout Sequent assente" >&2
  exit 1
}
[[ "$(git_as_checkout_owner rev-parse HEAD)" == "$commit" ]] || {
  echo "ERRORE: checkout non exact-commit" >&2
  exit 1
}
expected_tree="$(git_as_checkout_owner rev-parse "$commit^{tree}")"
[[ "$expected_tree" =~ ^[0-9a-f]{40}$ ]] || {
  echo "ERRORE: tree Git atteso non valido" >&2
  exit 1
}
object_directory="$(git_as_checkout_owner rev-parse --path-format=absolute --git-path objects)"
[[ "$object_directory" == "$repository/"* && -d "$object_directory" && ! -L "$object_directory" ]] || {
  echo "ERRORE: object database Git non confinato" >&2
  exit 1
}
git_as_checkout_owner diff --quiet
git_as_checkout_owner diff --cached --quiet
if git_as_checkout_owner ls-tree -r "$commit" | /usr/bin/cut -d' ' -f1 | /usr/bin/grep -qx 160000; then
  echo "ERRORE: gitlink non ammesso nel tree di deploy" >&2
  exit 1
fi

trusted_source="$(mktemp -d /run/sequent-deploy-source.XXXXXX)"
verification_git="$(mktemp -d /run/sequent-deploy-verification.XXXXXX)"
cleanup() {
  if [[ "$trusted_source" == /run/sequent-deploy-source.* ]]; then
    rm -rf --one-file-system "$trusted_source"
  fi
  if [[ "$verification_git" == /run/sequent-deploy-verification.* ]]; then
    rm -rf --one-file-system "$verification_git"
  fi
  if [[ "$docker_config" == /run/sequent-ghcr-* ]]; then
    rm -rf --one-file-system "$docker_config"
  fi
}
trap cleanup EXIT HUP INT TERM

/bin/chmod 0755 "$trusted_source"
/bin/chown "$verification_user":ubuntu "$verification_git"
/bin/chmod 0700 "$verification_git"
git_as_tree_verifier init --quiet
git_as_tree_verifier archive --format=tar "$commit" |
  /usr/bin/tar --extract --directory "$trusted_source" --no-same-owner --no-same-permissions
/bin/chown -R root:root "$trusted_source"
/bin/chmod -R go-w "$trusted_source"
/bin/chmod 0755 "$trusted_source"
git_as_tree_verifier add --all --force -- .
extracted_tree="$(git_as_tree_verifier write-tree)"
[[ "$extracted_tree" == "$expected_tree" ]] || {
  echo "ERRORE: tree estratto divergente dal commit" >&2
  exit 1
}
trusted_manifest="$trusted_source/release-manifest.json"
/usr/bin/install -o root -g root -m 0600 "$manifest" "$trusted_manifest"
[[ "$(/usr/bin/sha256sum "$trusted_manifest" | /usr/bin/cut -d' ' -f1)" == "$manifest_sha256" ]] || {
  echo "ERRORE: SHA manifest divergente" >&2
  exit 1
}
deploy_script="$trusted_source/scripts/vps/deploy-release.sh"
[[ -f "$deploy_script" && ! -L "$deploy_script" ]] || {
  echo "ERRORE: deploy exact-commit assente o non regolare" >&2
  exit 1
}
deploy_mode="$(git_as_checkout_owner ls-tree "$commit" -- scripts/vps/deploy-release.sh |
  /usr/bin/cut -d' ' -f1)"
[[ "$deploy_mode" == 100755 ]] || {
  echo "ERRORE: modo Git del deploy exact-commit non qualificato" >&2
  exit 1
}
/bin/chmod 0755 "$deploy_script"
[[ "$(/usr/bin/stat -c '%U:%G:%a' "$deploy_script")" == root:root:755 ]] || {
  echo "ERRORE: permessi del deploy exact-commit non ripristinabili" >&2
  exit 1
}

SEQUENT_TRUSTED_REPOSITORY="$trusted_source" \
  SEQUENT_CHECKOUT_REPOSITORY="$repository" \
  DOCKER_CONFIG="$docker_config" \
  /bin/bash "$deploy_script" --commit "$commit" --image-ref "$image_ref" --manifest "$trusted_manifest"
