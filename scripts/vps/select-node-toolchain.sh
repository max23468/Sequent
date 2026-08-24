#!/usr/bin/env bash
set -euo pipefail

toolchain_root="${SEQUENT_TOOLCHAIN_ROOT:-/opt/sequent/runtime/toolchains}"
selection="${1:-}"

fail() {
  echo "ERRORE: $*" >&2
  exit 1
}

validate_target() {
  local target="$1"
  [[ "$target" == versions/* ]] || fail "target toolchain fuori dalla directory versions"
  [[ -x "$toolchain_root/$target/bin/node" ]] || fail "binario node mancante in $target"
  [[ -x "$toolchain_root/$target/bin/npm" ]] || fail "binario npm mancante in $target"
}

replace_link() {
  local link_name="$1"
  local target="$2"
  ln -sfn "$target" "$toolchain_root/$link_name"
}

[[ -d "$toolchain_root/versions" ]] || fail "directory versions mancante"

if [[ "$selection" == "--rollback" ]]; then
  [[ -L "$toolchain_root/node-current" ]] || fail "toolchain corrente non configurata"
  [[ -L "$toolchain_root/node-rollback" ]] || fail "toolchain di rollback non configurata"
  current_target="$(readlink "$toolchain_root/node-current")"
  rollback_target="$(readlink "$toolchain_root/node-rollback")"
  validate_target "$current_target"
  validate_target "$rollback_target"
  replace_link node-current "$rollback_target"
  replace_link node-rollback "$current_target"
else
  [[ "$selection" =~ ^[A-Za-z0-9._-]+$ ]] || fail "identificatore toolchain non valido"
  candidate_target="versions/$selection"
  validate_target "$candidate_target"
  if [[ -L "$toolchain_root/node-current" ]]; then
    current_target="$(readlink "$toolchain_root/node-current")"
    validate_target "$current_target"
    if [[ "$current_target" != "$candidate_target" ]]; then
      replace_link node-rollback "$current_target"
    fi
  fi
  replace_link node-current "$candidate_target"
fi

SEQUENT_NODE_ROOT="$toolchain_root/node-current" "$(dirname "$0")/with-node.sh" node --version
SEQUENT_NODE_ROOT="$toolchain_root/node-current" "$(dirname "$0")/with-node.sh" npm --version

if [[ -L "$toolchain_root/node-rollback" ]]; then
  SEQUENT_NODE_ROOT="$toolchain_root/node-rollback" "$(dirname "$0")/with-node.sh" node --version
  SEQUENT_NODE_ROOT="$toolchain_root/node-rollback" "$(dirname "$0")/with-node.sh" npm --version
fi

echo "OK: selezione toolchain Sequent verificata"
