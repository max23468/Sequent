#!/usr/bin/env bash
set -euo pipefail

node_root="${SEQUENT_NODE_ROOT:-/opt/sequent/runtime/toolchains/node-current}"

if [[ ! -x "$node_root/bin/node" ]]; then
  echo "Toolchain Node Sequent non disponibile in $node_root" >&2
  exit 1
fi

export PATH="$node_root/bin:$PATH"
exec "$@"
