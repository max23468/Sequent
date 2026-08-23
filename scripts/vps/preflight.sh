#!/usr/bin/env bash
set -euo pipefail

expected_root="${SEQUENT_ROOT:-/opt/sequent}"
expected_host="${SEQUENT_EXPECTED_HOST:-fatture-hub-vm}"

fail() {
  echo "ERRORE: $*" >&2
  exit 1
}

[[ "$(hostname -s)" == "$expected_host" ]] || fail "hostname inatteso"
[[ "$(uname -m)" == "aarch64" ]] || fail "architettura non ARM64"
[[ -d /opt/hub-fatture ]] || fail "installazione Hub Fatture non rilevata"

for directory in repo runtime data private releases snapshots tmp; do
  [[ -d "$expected_root/$directory" ]] || fail "directory mancante: $directory"
done

[[ ! -w "$expected_root/data" ]] || fail "il checkout può scrivere nei dati operativi"
[[ "$(stat -c '%U:%G:%a' "$expected_root/data")" == "sequent-runtime:sequent-runtime:700" ]] ||
  fail "proprietà o permessi data non conformi"
[[ "$(stat -c '%U:%G:%a' "$expected_root/private")" == "ubuntu:ubuntu:700" ]] ||
  fail "proprietà o permessi private non conformi"

"$expected_root/repo/scripts/vps/with-node.sh" node --version
"$expected_root/repo/scripts/vps/with-node.sh" npm --version

echo "OK: preflight VPS Sequent"
