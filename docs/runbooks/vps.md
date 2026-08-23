# Runbook VPS

## Target canonico

- host: `fatture-hub-vm`, VPS OCI Milano;
- accesso amministrativo: SSH come `ubuntu` tramite `fatture.opik.net`;
- architettura: ARM64;
- checkout: `/opt/sequent/repo/`;
- nessun hostname o servizio Sequent attivo durante M0.

## Layout e proprietari

| Percorso | Proprietario | Modalità | Uso |
|---|---|---:|---|
| `/opt/sequent/repo` | `ubuntu:ubuntu` | `0750` | checkout Git |
| `/opt/sequent/runtime` | `ubuntu:ubuntu` | `0750` | toolchain e runtime futuro |
| `/opt/sequent/data` | `sequent-runtime:sequent-runtime` | `0700` | dati operativi, non scrivibili dal checkout |
| `/opt/sequent/private` | `ubuntu:ubuntu` | `0700` | fonti ufficiali e corpus fuori da Git |
| `/opt/sequent/releases` | `ubuntu:ubuntu` | `0750` | release approvate future |
| `/opt/sequent/snapshots` | `ubuntu:ubuntu` | `0700` | rollback tecnico |
| `/opt/sequent/tmp` | `ubuntu:ubuntu` | `0700` | copie isolate per prove rischiose |

Il runtime applicativo non è ancora installato. L'utente di sistema `sequent-runtime` non possiede login né home e riserva il confine dei dati operativi.

## Toolchain M0

Node `26.7.0` e npm `11.19.0` provengono dall'archivio ARM64 ufficiale verificato con `SHASUMS256.txt`. Il puntatore stabile è `/opt/sequent/runtime/toolchains/node-current`; non viene aggiunto al `PATH` globale per non interferire con Hub Fatture.

Usare il wrapper versionato:

```bash
cd /opt/sequent/repo
scripts/vps/with-node.sh npm ci
scripts/vps/with-node.sh npm run verify:public
scripts/vps/with-node.sh npm run verify:sources
scripts/vps/preflight.sh
```

Prerequisiti host M0: Git, rsync, unzip, `libxml2-utils`, `poppler-utils`, `python3-lxml` e `libatomic1`.

## Confini operativi

- non eseguire la working tree come servizio;
- non montare `/opt/sequent/data` nel checkout;
- eseguire restore, migrazioni e import DIZ rischiosi soltanto su copie in `/opt/sequent/tmp`;
- non modificare Caddy, Dynu, firewall o `/opt/hub-fatture` senza autorizzazione separata;
- non eliminare il source bundle privato finché non esiste una copia di sicurezza indipendente verificata.
