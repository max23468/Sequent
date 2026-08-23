#!/usr/bin/env bash
set -euo pipefail

expected_root="${SEQUENT_ROOT:-/opt/sequent}"
expected_host="${SEQUENT_EXPECTED_HOST:-fatture-hub-vm}"

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

[[ "$(hostname -s)" == "$expected_host" ]] || fail "hostname inatteso"
[[ "$(uname -m)" == "aarch64" ]] || fail "architettura non ARM64"
[[ -d /opt/hub-fatture ]] || fail "installazione Hub Fatture non rilevata"

for directory in repo runtime data private releases snapshots tmp; do
  [[ -d "$expected_root/$directory" ]] || fail "directory mancante: $directory"
done

[[ ! -w "$expected_root/data" ]] || fail "il checkout può scrivere nei dati operativi"
assert_layout . ubuntu:ubuntu:750
assert_layout repo ubuntu:ubuntu:750
assert_layout runtime ubuntu:ubuntu:750
assert_layout data sequent-runtime:sequent-runtime:700
assert_layout private ubuntu:ubuntu:700
assert_layout releases ubuntu:ubuntu:750
assert_layout snapshots ubuntu:ubuntu:700
assert_layout tmp ubuntu:ubuntu:700

"$expected_root/repo/scripts/vps/with-node.sh" node --version
"$expected_root/repo/scripts/vps/with-node.sh" npm --version

echo "OK: preflight VPS Sequent"
