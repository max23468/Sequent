#!/bin/sh
set -eu

umask 077

config_root=${XDG_CONFIG_HOME:-"$HOME/.config"}
config_file=${SEQUENT_LOCAL_VPS_CONFIG:-"$config_root/sequent/local-vps.env"}

fail() {
  echo "$1" >&2
  exit 1
}

[ -f "$config_file" ] || fail "Configurazione VPS privata assente: $config_file"

# Il file e i suoi valori restano locali e ignorati da Git.
# shellcheck disable=SC1090
. "$config_file"

ssh_host=${SEQUENT_SSH_HOST:-}
ssh_user=${SEQUENT_SSH_USER:-}
encrypted_key=${SEQUENT_SSH_KEY_AGE:-}
age_identity=${SEQUENT_AGE_IDENTITY:-}

[ -n "$ssh_host" ] || fail "SEQUENT_SSH_HOST assente nella configurazione privata"
[ -n "$ssh_user" ] || fail "SEQUENT_SSH_USER assente nella configurazione privata"
[ -f "$encrypted_key" ] || fail "Blob SSH cifrato assente"
[ -f "$age_identity" ] || fail "Identità age del recovery kit assente"

for required_command in age ssh ssh-add ssh-agent; do
  command -v "$required_command" >/dev/null 2>&1 \
    || fail "Comando richiesto assente: $required_command"
done

temporary_dir=$(mktemp -d "${TMPDIR:-/tmp}/sequent-ssh.XXXXXX")
export SSH_AUTH_SOCK="$temporary_dir/agent.sock"
agent_started=false

# Invocata indirettamente dal trap.
# shellcheck disable=SC2329
cleanup() {
  if [ "$agent_started" = true ]; then
    ssh-agent -k >/dev/null 2>&1 || true
  fi
  rm -rf "$temporary_dir"
}
trap cleanup EXIT HUP INT TERM

agent_environment=$(ssh-agent -a "$SSH_AUTH_SOCK" -s)
eval "$agent_environment" >/dev/null
agent_started=true

if ! age --decrypt -i "$age_identity" "$encrypted_key" 2>/dev/null \
  | ssh-add - >/dev/null 2>&1; then
  fail "Impossibile caricare la chiave SSH dal recovery kit"
fi

# Il file pubblico temporaneo limita l'offerta alla sola identità caricata,
# senza scrivere su disco la chiave privata decifrata.
ssh-add -L >"$temporary_dir/identity.pub"

set +e
ssh -o BatchMode=yes -o IdentitiesOnly=yes -o IdentityAgent="$SSH_AUTH_SOCK" \
  -i "$temporary_dir/identity.pub" "$ssh_user@$ssh_host" "$@"
status=$?
set -e
exit "$status"
