# Runbook VPS

## Target canonico

- identità reale dell'host e target amministrativo: configurazione privata fuori da Git;
- accesso amministrativo: comando locale `sequent-ssh`, senza utente o endpoint nel repository pubblico;
- architettura: ARM64;
- checkout: `/opt/sequent/repo/`;
- hostname e servizio Sequent restano inattivi finché non esiste un'autorizzazione esplicita all'attivazione.

Il preflight legge per default `/opt/sequent/private/preflight.env`, posseduto dall'utente amministrativo e con modalità `0600`. Il file definisce `SEQUENT_EXPECTED_HOST` e `SEQUENT_SHARED_INSTALLATION_MARKER`; i valori effettivi non devono essere copiati in Git, PR, issue o log condivisi. `SEQUENT_PREFLIGHT_ENV` può indicare un file privato alternativo.

## Base dell'immagine applicativa

Tutti gli stage applicativi usano Debian 13 Slim sull'immagine Node ufficiale fissata per digest nel `Dockerfile`. La VPS host resta Ubuntu e non viene modificata da questa scelta. Il manifest della base deve includere `linux/arm64`; `scripts/local/verify-docker-runtime.sh` verifica distribuzione, glibc, Node/npm, converter, lingua italiana, assenza dei tool di build, percorso vendor non scrivibile e inventario setuid prima che l'artefatto possa essere qualificato.

APT usa un solo snapshot APT Debian immutabile, derivato dal timestamp dichiarato dalla base ufficiale. Non eseguire aggiornamenti generali della distribuzione durante la build: gli aggiornamenti entrano tramite pull request sul digest Docker e, quando necessario, tramite avanzamento deliberato e congiunto dello snapshot. Non esistono una variante Alpine o un fallback musl.

## Accesso amministrativo locale

Il comando versionato `scripts/local/ssh-vps.sh` legge per default `~/.config/sequent/local-vps.env`, esterno a Git e mantenuto con modalità `0600`. La configurazione privata definisce `SEQUENT_SSH_HOST`, `SEQUENT_SSH_USER`, `SEQUENT_SSH_KEY_AGE` e `SEQUENT_AGE_IDENTITY`; endpoint, utente e percorsi reali non devono comparire nel repository pubblico.

Sul client amministrativo, esporre il comando con un collegamento locale stabile:

```bash
mkdir -p ~/.local/bin
install -m 0755 scripts/local/ssh-vps.sh ~/.local/bin/sequent-ssh
sequent-ssh
```

Il wrapper decifra la chiave soltanto in streaming verso un `ssh-agent` effimero, offre esclusivamente l'identità appena caricata e distrugge agente e directory temporanea all'uscita. Non crea una copia in chiaro della chiave privata.

## Layout e proprietari

| Percorso                 | Proprietario                      | Modalità | Uso                                         |
| ------------------------ | --------------------------------- | -------: | ------------------------------------------- |
| `/opt/sequent`           | `root:root`                       |   `0755` | radice non sostituibile dall’account SSH    |
| `/opt/sequent/repo`      | `ubuntu:ubuntu`                   |   `0750` | checkout Git                                |
| `/opt/sequent/runtime`   | `root:ubuntu`                     |   `0750` | runtime non sostituibile; toolchain leggibile |
| `/opt/sequent/data`      | `sequent-runtime:sequent-runtime` |   `0700` | dati operativi, non scrivibili dal checkout |
| `/opt/sequent/private`   | `ubuntu:ubuntu`                   |   `0700` | corpus reale, dati operativi e segreti      |
| `/opt/sequent/releases`  | `root:root`                       |   `0750` | release approvate future                    |
| `/opt/sequent/snapshots` | `root:root`                       |   `0700` | rollback tecnico e copie isolate di deploy  |
| `/opt/sequent/tmp`       | `ubuntu:ubuntu`                   |   `0700` | copie isolate per prove rischiose           |

Il runtime applicativo resta inattivo finché non viene approvata una release. L'utente di sistema `sequent-runtime` non possiede login né home e riserva il confine dei dati operativi. `deploy/compose.example.yml` descrive il singolo servizio isolato, ma non è una configurazione attiva e non autorizza il deploy.

La configurazione privata del runtime valorizza `SEQUENT_RUNTIME_UID` e `SEQUENT_RUNTIME_GID` con gli identificativi numerici reali di `sequent-runtime`. Deve inoltre definire `SEQUENT_ORIGIN` come origine HTTPS completa e canonica dell'applicazione, senza percorso. La corsia di deploy tratta il file esclusivamente come dati: accetta le sole quattro chiavi canoniche, ne valida formato e unicità, confronta UID e GID con l’account di sistema e passa a Compose una copia temporanea `root:root` non scrivibile dall'account SSH; non interpreta mai il file come shell. Compose esegue il processo con questi valori: il bind mount `/opt/sequent/data` resta scrivibile senza allargare i permessi e l’immagine conserva comunque un utente non-root predefinito per gli smoke isolati.

Il runtime riceve richieste pubbliche esclusivamente da Caddy attraverso il binding di loopback dichiarato in Compose. `ORIGIN` vincola la ricostruzione degli URL e la protezione CSRF all'origine HTTPS dichiarata. Per il rate limit del login, adapter-node legge `X-Forwarded-For` con `XFF_DEPTH=1`: la configurazione Caddy qualificata deve quindi sovrascrivere gli header inoltrati dal client e rappresentare l'unico hop davanti a Sequent. Aggiungere un altro proxy richiede una nuova qualifica esplicita della profondità; non aumentarla preventivamente.

Il virtual host condiviso raggiunge l'app tramite la rete esterna dedicata `sequent-proxy`. Caddy è l'unico container collegato sia alla propria rete frontend sia a `sequent-proxy`; il servizio Sequent resta inoltre sulla rete applicativa `sequent`, mentre i container applicativi di Hub Fatture non entrano in nessuna rete Sequent. La rete esterna deve esistere prima della prima attivazione e la configurazione persistente del proxy deve dichiararla esplicitamente, così un riavvio o una ricreazione di Caddy non perde il collegamento. La route usa l'alias Compose `sequent` sulla porta applicativa interna; il binding loopback canonico resta riservato a health e amministrazione locale.

Il `tmpfs` di `/tmp` usa gli stessi UID e GID numerici del processo applicativo e la modalità sticky standard `1777`. OCR, LibreOffice e gli altri processi figli possono così creare temporanei senza rendere scrivibile il filesystem dell'immagine; il sandbox Codex può inoltre attraversare il solo workspace effimero che gli viene montato in lettura.

Il processo Node resta non root e senza capability effettive. L'immagine rimuove ogni bit setuid/setgid preesistente e lo assegna soltanto a un launcher minimo della CLI Codex, che porta UID e GID reali a root prima di avviare il binario vendor da un percorso fisso e non scrivibile. Il bounding set del container contiene esclusivamente `DAC_OVERRIDE`, `NET_ADMIN`, `SETFCAP`, `SETGID`, `SETUID` e `SYS_ADMIN`, richieste da `bwrap` per leggere la home autenticata e creare le mappe, i mount e il loopback dei namespace isolati. Le eccezioni `seccomp=unconfined` e `apparmor=unconfined` consentono le relative syscall; il filesystem dell'immagine resta in sola lettura. Senza questa configurazione il login risulta valido, ma ogni analisi fallisce prima dell'avvio della run. L'isolamento applicativo Codex continua a consentire la lettura del solo workspace temporaneo e a negare la rete agli strumenti del modello.

## Prima attivazione e deploy

La corsia `Production` trasferisce sulla VPS esclusivamente l'archivio ARM64 e il manifest prodotti dal run `Release candidate` exact-commit. Non esegue build sulla VPS. Prima di ogni invocazione trasferisce anche `scripts/vps/run-trusted-deploy.sh`: ne copia i byte in un file temporaneo root-owned, verifica da root lo SHA-256 calcolato sull'HEAD esatto dal runner GitHub e solo allora lo installa come `/usr/local/sbin/sequent-run-trusted-deploy`, `root:root:0755`. Il launcher accetta sia il layout storico qualificato `ubuntu:ubuntu` sia quello corrente e migra in modo fail-closed la radice, `releases` e `snapshots` al layout root-owned prima dei nuovi assert; proprietari o modalità diversi bloccano l'operazione. Verifica quindi l'HEAD e la pulizia del checkout, poi crea se assente l'account di sistema senza login `sequent-deploy`, con gruppo primario `ubuntu`: questo account può leggere gli oggetti del checkout ma non può modificare né il checkout né la directory temporanea Git che possiede in modo esclusivo. Da tale object database, con configurazioni globali e di sistema escluse e replace ref disabilitati, produce `git archive`, ricostruisce il tree estratto e lo confronta con il tree dell'esatto commit prima che root esegua alcuno script. Infine copia nel tree root-owned gli artefatti e ne confronta gli SHA-256 calcolati dal runner GitHub prima del trasferimento; il deploy usa soltanto queste copie immutabili. Il file di deploy deve conservare nel commit il modo Git `100755` ed essere `root:root:0755` nel tree verificato; viene poi interpretato con `/bin/bash`, così la corsia resta compatibile con `/run` montato `noexec` su Debian 13 senza allentare i controlli di provenienza. Nessuno script o artefatto scrivibile dall'account SSH viene elevato direttamente. L'invocazione operativa usa percorsi temporanei controllati:

```bash
sudo /usr/local/sbin/sequent-run-trusted-deploy \
  --commit <sha-main> \
  --archive /opt/sequent/tmp/<trasferimento>/sequent-release-arm64.tar \
  --archive-sha256 <sha256> \
  --manifest /opt/sequent/tmp/<trasferimento>/release-manifest.json \
  --manifest-sha256 <sha256>
```

Il comando serializza l'operazione sul lock Docker condiviso, verifica disco, HEAD e artefatto, controlla il database e l'assenza di job attivi, quindi avvia la candidata su una copia isolata dei dati collocata sotto il parent `snapshots` non sostituibile dall’account SSH. Soltanto dopo health e coerenza SQLite della copia attiva la manutenzione, arresta il container Sequent e crea uno snapshot esclusivo dei dati ormai quiescenti prima di applicare il nuovo Compose. Le operazioni Git sul checkout vengono eseguite senza privilegi come `ubuntu`; sia il Compose candidato sia quello di rollback provengono da tree Git immutabili e vengono consumati da file `root:root` sotto `/run`. Un marker nei dati operativi blocca con `503` le richieste mutanti e impedisce al job runner di reclamare attività durante l’intera transazione. Il readback HTTPS vincola image ID, commit OCI, utente, filesystem, capability, health e database mentre il marker è ancora attivo; se fallisce ripristina automaticamente lo snapshot e l'immagine precedente, altrimenti rimuove il marker come ultima operazione della transazione. Non esegue down migration e non modifica Caddy, Dynu, firewall o servizi estranei.

Ogni release riuscita conserva archivio, manifest, image ID e ricevuta sotto `/opt/sequent/releases/<sha>/`; lo snapshot precedente resta sotto `/opt/sequent/snapshots/`. La retention predefinita conserva le due release e i due snapshot più recenti, cioè runtime e rollback, e accetta l'image ID immutabile come riferimento corrente. La prima attivazione richiede inoltre una route Caddy qualificata, con Caddy quale unico proxy e `X-Forwarded-For` sovrascritto. Le release successive riutilizzano quella route e non mutano l'infrastruttura pubblica.

## Toolchain

Le versioni richieste di Node e npm sono definite dagli `engines` di `package.json` e dal lockfile. Sulla VPS provengono dall'archivio ARM64 ufficiale verificato con `SHASUMS256.txt`. Le installazioni immutabili vivono sotto `/opt/sequent/runtime/toolchains/versions/`; i puntatori `node-current` e `node-rollback` identificano rispettivamente la linea attiva e quella di ritorno. Nessuna delle due viene aggiunta al `PATH` globale, così la toolchain di Sequent non interferisce con Hub Fatture. La corsia privilegiata di deploy non esegue questa toolchain: interpreta manifest, health e ricevuta con `/usr/bin/python3` root-owned e usa Node soltanto all'interno dell'immagine candidata confinata dai gate runtime.

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

## Build temporanee e manutenzione immagini

La VPS condivide il solo motore Docker fisico con Hub Fatture. Deploy e manutenzioni HF e build Sequent usano quindi lo stesso lock host, senza leggere configurazioni o dati dell’altro prodotto. Una build temporanea parte soltanto sotto l’80% di utilizzo disco e usa un tag `sequent:tmp-*` gestito dal wrapper:

```bash
sudo scripts/vps/with-temporary-docker-image.sh sequent:tmp-verifica -- \
  sh -c 'docker build --build-arg APP_COMMIT_SHA="$SEQUENT_IMAGE_REVISION" --tag "$SEQUENT_TEMP_IMAGE" . && docker run --rm "$SEQUENT_TEMP_IMAGE"'
```

Il wrapper serializza l’operazione, ricava l’HEAD esatto per il label OCI e, anche in caso di errore, elimina container, tag e soltanto i layer dangling comparsi durante il proprio comando. Non usarlo per l’immagine della release attiva.

La manutenzione periodica è selettiva. Riconosce le immagini del prodotto dal label OCI canonico o dal namespace locale esatto `sequent:*`, così copre anche build precedenti all’introduzione del label senza coinvolgere immagini di HF o di altri repository:

```bash
sudo scripts/vps/prune-docker-images.sh --dry-run
sudo scripts/vps/prune-docker-images.sh
```

La pulizia protegge sempre runtime corrente, precedente immagine attiva di rollback e qualunque immagine referenziata da un container. Il runtime può essere identificato dal digest Docker previsto dal Compose oppure dai tag locali exact-commit `sequent:*` e `sequent-release:*`. Un candidato VPS qualificato che deve sopravvivere oltre la finestra si registra con il suo image ID completo, una riga per immagine, in `/opt/sequent/runtime/retained-image-ids`; una riga invalida o un’immagine assente blocca la pulizia e un ID trattenuto non può occupare lo slot di rollback. Le immagini Sequent e i layer dangling attribuibili al prodotto hanno una finestra di sicurezza predefinita di 24 ore; ridurla richiede prima la verifica che non esistano build o task concorrenti.

L’installazione operativa colloca lo script root-owned in `/usr/local/sbin/sequent-prune-docker-images`, fuori dalle directory modificabili dall’account SSH, e abilita `sequent-docker-prune.timer`. Il timer esegue la stessa manutenzione una volta al giorno con ritardo casuale, resta idempotente dopo un riavvio e non aggira il lock condiviso. Installazione e aggiornamento dello script e delle unità fanno parte della futura corsia di release o di una manutenzione VPS esplicitamente autorizzata.

## Rollback immutabile dell'immagine

La migrazione della distribuzione del container non modifica schema o dati. Il rollback deve quindi selezionare la candidata ARM64 precedente già qualificata, senza ricostruirla e senza down migration:

1. identificare SHA precedente, archivio ARM64 e relativo `release-manifest.json` nel registro delle release approvate;
2. eseguire `scripts/github/release-artifact.mjs verify` sull'archivio e sul manifest prima del caricamento;
3. caricare l'archivio verificato e rileggere image ID, piattaforma, label OCI del commit e digest dichiarati dal manifest;
4. durante una finestra di deploy separatamente autorizzata, puntare il Compose al digest precedente senza modificare i volumi dati;
5. verificare health, commit, image ID, digest, Node, npm e converter dopo il riavvio;
6. se il readback diverge, lasciare il servizio fermo e investigare senza ricostruire o sostituire l'artefatto di rollback.

SHA, digest e nomi esatti degli artefatti appartengono al manifest e all'evidenza della migrazione, non a questo runbook stabile.

## Confini operativi

- non eseguire la working tree come servizio;
- non montare `/opt/sequent/data` nel checkout;
- eseguire restore, migrazioni e import DIZ rischiosi soltanto su copie in `/opt/sequent/tmp`;
- non modificare Caddy, Dynu, firewall o l'installazione condivisa indicata dalla configurazione privata senza autorizzazione separata;
- non eliminare il source bundle privato finché non esiste una copia di sicurezza indipendente verificata.
- non eseguire `docker build` direttamente sulla VPS: usare il wrapper temporaneo o la corsia di release approvata;
