# Runbook VPS

## Target canonico

- identità reale dell'host e target amministrativo: configurazione privata fuori da Git;
- accesso amministrativo: alias SSH configurato localmente, senza utente o endpoint nel repository pubblico;
- architettura: ARM64;
- checkout: `/opt/sequent/repo/`;
- nessun hostname o servizio Sequent attivo durante M0.

Il preflight legge per default `/opt/sequent/private/preflight.env`, posseduto dall'utente amministrativo e con modalità `0600`. Il file definisce `SEQUENT_EXPECTED_HOST` e `SEQUENT_SHARED_INSTALLATION_MARKER`; i valori effettivi non devono essere copiati in Git, PR, issue o log condivisi. `SEQUENT_PREFLIGHT_ENV` può indicare un file privato alternativo.

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
- non modificare Caddy, Dynu, firewall o l'installazione condivisa indicata dalla configurazione privata senza autorizzazione separata;
- non eliminare il source bundle privato finché non esiste una copia di sicurezza indipendente verificata.
