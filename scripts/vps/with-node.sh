#!/usr/bin/env bash
set -euo pipefail

node_slot="${SEQUENT_NODE_SLOT:-current}"
case "$node_slot" in
  current | rollback) ;;
  *)
    echo "Slot toolchain Sequent non valido: $node_slot" >&2
    exit 1
    ;;
esac

node_root="${SEQUENT_NODE_ROOT:-/opt/sequent/runtime/toolchains/node-$node_slot}"

if [[ ! -x "$node_root/bin/node" ]]; then
  echo "Toolchain Node Sequent non disponibile in $node_root" >&2
  exit 1
fi

export PATH="$node_root/bin:$PATH"
exec "$@"
