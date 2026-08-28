#!/usr/bin/env bash
set -euo pipefail

expected_root="${SEQUENT_ROOT:-/opt/sequent}"
preflight_env="${SEQUENT_PREFLIGHT_ENV:-$expected_root/private/preflight.env}"

fail() {
  echo "ERRORE: $*" >&2
  exit 1
}

assert_layout() {
  local relative_path="$1"
  local expected="$2"
  local actual
  actual="$(stat -c '%U:%G:%a' "$expected_root/$relative_path")"
  [[ "$actual" == "$expected" ]] ||
    fail "layout non conforme per $relative_path: $actual != $expected"
}

load_private_config() {
  if [[ -z "${SEQUENT_EXPECTED_HOST:-}" || -z "${SEQUENT_SHARED_INSTALLATION_MARKER:-}" ]]; then
    [[ -f "$preflight_env" ]] || fail "configurazione preflight privata mancante"
    [[ -r "$preflight_env" ]] || fail "configurazione preflight privata non leggibile"
    [[ "$(stat -c '%U:%a' "$preflight_env")" == "$(id -un):600" ]] ||
      fail "proprietà o permessi della configurazione preflight non conformi"

    # Il file è fidato soltanto dopo la verifica di proprietario e modalità.
    # shellcheck source=/dev/null
    source "$preflight_env"
  fi

  [[ -n "${SEQUENT_EXPECTED_HOST:-}" ]] || fail "hostname atteso non configurato"
  [[ -n "${SEQUENT_SHARED_INSTALLATION_MARKER:-}" ]] ||
    fail "marker dell'installazione condivisa non configurato"
  [[ "$SEQUENT_SHARED_INSTALLATION_MARKER" == /* ]] ||
    fail "il marker dell'installazione condivisa deve essere un percorso assoluto"
  [[ "$SEQUENT_SHARED_INSTALLATION_MARKER" != "/" ]] ||
    fail "marker dell'installazione condivisa non valido"
}

load_private_config

[[ "$(hostname -s)" == "$SEQUENT_EXPECTED_HOST" ]] || fail "hostname inatteso"
[[ "$(uname -m)" == "aarch64" ]] || fail "architettura non ARM64"
[[ -d "$SEQUENT_SHARED_INSTALLATION_MARKER" ]] ||
  fail "installazione condivisa attesa non rilevata"

for directory in repo runtime data private releases snapshots tmp; do
  [[ -d "$expected_root/$directory" ]] || fail "directory mancante: $directory"
done

[[ ! -w "$expected_root/data" ]] || fail "il checkout può scrivere nei dati operativi"
assert_layout . root:root:755
assert_layout repo ubuntu:ubuntu:750
assert_layout runtime root:ubuntu:750
assert_layout data sequent-runtime:sequent-runtime:700
assert_layout private ubuntu:ubuntu:700
assert_layout releases root:root:750
assert_layout snapshots root:root:700
assert_layout tmp ubuntu:ubuntu:700

SEQUENT_NODE_SLOT=current "$expected_root/repo/scripts/vps/with-node.sh" node --version
SEQUENT_NODE_SLOT=current "$expected_root/repo/scripts/vps/with-node.sh" npm --version
SEQUENT_NODE_SLOT=rollback "$expected_root/repo/scripts/vps/with-node.sh" node --version
SEQUENT_NODE_SLOT=rollback "$expected_root/repo/scripts/vps/with-node.sh" npm --version

echo "OK: preflight VPS Sequent"
