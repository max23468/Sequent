# Runbook VPS

## Target canonico

- identità reale dell'host e target amministrativo: configurazione privata fuori da Git;
- accesso amministrativo: alias SSH configurato localmente, senza utente o endpoint nel repository pubblico;
- architettura: ARM64;
- checkout: `/opt/sequent/repo/`;
- hostname e servizio Sequent restano inattivi finché non esiste un'autorizzazione esplicita all'attivazione.

Il preflight legge per default `/opt/sequent/private/preflight.env`, posseduto dall'utente amministrativo e con modalità `0600`. Il file definisce `SEQUENT_EXPECTED_HOST` e `SEQUENT_SHARED_INSTALLATION_MARKER`; i valori effettivi non devono essere copiati in Git, PR, issue o log condivisi. `SEQUENT_PREFLIGHT_ENV` può indicare un file privato alternativo.

## Layout e proprietari

| Percorso                 | Proprietario                      | Modalità | Uso                                         |
| ------------------------ | --------------------------------- | -------: | ------------------------------------------- |
| `/opt/sequent/repo`      | `ubuntu:ubuntu`                   |   `0750` | checkout Git                                |
| `/opt/sequent/runtime`   | `ubuntu:ubuntu`                   |   `0750` | toolchain e runtime futuro                  |
| `/opt/sequent/data`      | `sequent-runtime:sequent-runtime` |   `0700` | dati operativi, non scrivibili dal checkout |
| `/opt/sequent/private`   | `ubuntu:ubuntu`                   |   `0700` | fonti ufficiali e corpus fuori da Git       |
| `/opt/sequent/releases`  | `ubuntu:ubuntu`                   |   `0750` | release approvate future                    |
| `/opt/sequent/snapshots` | `ubuntu:ubuntu`                   |   `0700` | rollback tecnico                            |
| `/opt/sequent/tmp`       | `ubuntu:ubuntu`                   |   `0700` | copie isolate per prove rischiose           |

Il runtime applicativo resta inattivo finché non viene approvata una release. L'utente di sistema `sequent-runtime` non possiede login né home e riserva il confine dei dati operativi. `deploy/compose.example.yml` descrive il singolo servizio isolato, ma non è una configurazione attiva e non autorizza il deploy.

La configurazione privata del runtime valorizza `SEQUENT_RUNTIME_UID` e `SEQUENT_RUNTIME_GID` con gli identificativi numerici reali di `sequent-runtime`. Compose esegue il processo con questi valori: il bind mount `/opt/sequent/data` resta scrivibile senza allargare i permessi e l’immagine conserva comunque un utente non-root predefinito per gli smoke isolati.

## Toolchain

Le versioni richieste di Node e npm sono definite dagli `engines` di `package.json` e dal lockfile. Sulla VPS provengono dall'archivio ARM64 ufficiale verificato con `SHASUMS256.txt`. Le installazioni immutabili vivono sotto `/opt/sequent/runtime/toolchains/versions/`; i puntatori `node-current` e `node-rollback` identificano rispettivamente la linea attiva e quella di ritorno. Nessuna delle due viene aggiunta al `PATH` globale, così la toolchain di Sequent non interferisce con Hub Fatture.

La selezione avviene soltanto dopo avere collocato e verificato l'archivio nella directory `versions`:

```bash
scripts/vps/select-node-toolchain.sh <identificatore-directory>
```

Il comando conserva automaticamente la precedente linea corrente come rollback e verifica `node` e `npm` in entrambi gli slot. Durante una finestra di manutenzione, il ritorno scambia i due puntatori e li verifica di nuovo:

```bash
scripts/vps/select-node-toolchain.sh --rollback
```

Usare il wrapper versionato:

```bash
cd /opt/sequent/repo
scripts/vps/with-node.sh npm ci
scripts/vps/with-node.sh npm run verify:public
scripts/vps/with-node.sh npm run verify:sources
scripts/vps/preflight.sh
```

Prerequisiti host: Git, rsync, unzip, `libxml2-utils`, `poppler-utils`, `python3-lxml` e `libatomic1`.

## Confini operativi

- non eseguire la working tree come servizio;
- non montare `/opt/sequent/data` nel checkout;
- eseguire restore, migrazioni e import DIZ rischiosi soltanto su copie in `/opt/sequent/tmp`;
- non modificare Caddy, Dynu, firewall o l'installazione condivisa indicata dalla configurazione privata senza autorizzazione separata;
- non eliminare il source bundle privato finché non esiste una copia di sicurezza indipendente verificata.
