# Changelog

Tutte le modifiche rilevanti di Sequent sono documentate in questo file.

## Unreleased

## 0.2.6

### Added

- qualificazione riproducibile del runtime Codex tramite sessione ChatGPT dedicata e del corpus DIZ privato, con report sanitizzati legati alla release;
- esito dell’acquisizione DIZ e impronta SHA-256 completa resi visibili nel fascicolo ufficiale.

### Fixed

- controllo dell’autenticazione Codex confinato alla home privata di Sequent, rifiutando API key, configurazioni condivise e stati di logout ambigui;
- acquisizione e qualificazione DIZ rese fail-closed su conflitti, posizioni mancanti, metadati, evidenze opache e readback canonico;
- nomenclatura di roadmap rimossa dal codice permanente e gate documentale esteso a identificatori, nomi canonici e termine riservato delle milestone.

## 0.2.5

### Changed

- dominio, calcoli, persistenza, azioni del flusso ufficiale, fogli di stile e suite di test suddivisi in moduli coesi senza facciate di compatibilità legacy;
- dichiarazioni persistite validate integralmente sullo schema corrente, rifiutando strutture obsolete, incomplete o incoerenti invece di correggerle implicitamente;
- migrazioni del database eseguite soltanto quando la relativa versione risulta ancora pendente e configurazione runtime resa obbligatoriamente completa;
- asset operativi creati esclusivamente con il tipo corrente, senza conversione dei precedenti valori di categoria;
- dipendenza `pdf-lib` fissata alla versione esatta qualificata.

### Removed

- migrazioni una tantum già assorbite per layout VPS e feature flag, insieme alla relativa evidenza storica e ai rami runtime di retrocompatibilità.

## 0.2.4

### Fixed

- configurazione amministrativa delle feature flag resa eseguibile sul layout runtime protetto tramite comando root-owned installato dalla release, lock condiviso, validazione completa e sostituzione atomica senza eseguire file del checkout con privilegi.

## 0.2.3

### Fixed

- configurazione di deploy resa fail-closed e persistente per le feature flag operative Codex e DIZ, senza riabilitazioni implicite durante gli aggiornamenti;
- migrazione automatica della configurazione runtime precedente con entrambe le feature flag assenti verso lo stato esplicito e disabilitato, rifiutando stati parziali;
- confronto DIZ a tre vie reso stabile rispetto a rinomina opaca degli allegati, riordino delle mappe e metadati interni prodotti dal salvataggio ufficiale, mantenendo bloccanti le divergenze di campi, contenuti e byte.

## 0.2.2

### Added

- flusso ufficiale persistente per acquisizione, export e reimport DIZ, confronto a tre vie, telematici, diagnostici, ricevute, quietanze ed esiti volture;
- snapshot preventivi e di milestone della dichiarazione, fascicolo di artefatti immutabili e conferma motivata della presentazione quando la seconda ricevuta non è ottenibile;
- backup manuale ZIP dall’interfaccia con breve modalità manutenzione, verifica integrale e promemoria temporale.

### Changed

- backup esteso alla verifica dei blob referenziati da derivati, allegati preparati e artefatti del flusso ufficiale;
- cicli DIZ resi atomici e serializzati, con evidenza esplicita delle variazioni opache non promosse nel modello canonico;
- workspace della pratica esteso con la sezione “Invio e ricevute” e download autenticato senza cache dei file ufficiali.

## 0.2.1

### Fixed

- chiusura di `Pubblica` resa obbligatoria: riallineamento di `main`, rimozione verificata di branch e worktree del ciclo corrente e inventario esplicito dei residui concorrenti preservati;
- esecuzione remota diretta senza il wrapper di pulizia rifiutata prima del push e impossibilità di chiudere il repository rilevata in anticipo.

## 0.2.0

### Added

- offline selettivo per le pratiche scelte, con navigazione e documenti disponibili localmente, modifiche ai campi e allegati accodati;
- recovery ZIP delle modifiche locali dopo un restore server, gestione fail-closed dei conflitti di revisione e stato di sola lettura per migrazioni non sicure;
- migrazione versionata di IndexedDB, preflight dello spazio disponibile e matrice Playwright estesa a Chrome, Edge, Safari desktop e Safari mobile.

### Changed

- intestazione della pratica ricomposta in una barra armonica su desktop e in una griglia compatta su mobile, includendo dichiarazione, viste, stato online/offline e azioni;
- cache delle pratiche aggiornata atomicamente e conservata fra gli aggiornamenti del service worker, senza promuovere copie parziali;
- sincronizzazione offline resa conservativa rispetto alla revisione server e seguita dal refresh della copia locale.

### Fixed

- serializzazione di documenti e allegati compatibile con WebKit tramite byte binari conservati in IndexedDB;
- rimozione della copia offline e logout completati soltanto dopo la conferma di cancellazione della cache;
- rinomina della pratica stabile durante gli aggiornamenti reattivi e sui dispositivi WebKit touch.

## 0.1.9

### Added

- qualificazione ufficiale completa dei 715 campi della dichiarazione, inclusi produttore del valore, modalità di gestione, destinazione operativa e applicabilità;
- mappa deterministica Comune-conservatoria e calcolo contestuale delle circoscrizioni per le dichiarazioni ordinarie e sostitutive;
- harness server parametrico per il round-trip fra Vista Quadri e Vista operativa, con persistenza, revisioni concorrenti, dichiarazioni successive e occorrenze ripetibili isolate.

### Changed

- tutti i campi ufficiali risultano coperti nelle due viste: 644 inseriti dal professionista, 56 automatici, 8 riservati all’ufficio, 5 derivati e 2 contestuali;
- campi automatici, derivati e riservati all’ufficio condividono la stessa fonte canonica e restano in sola lettura in entrambe le viste;
- precedenza assegnata alle istruzioni ufficiali esplicite quando descrivono un input professionale, rispetto alla sola evidenza osservata nell’applicativo ufficiale.
- soglia predefinita del gate disco per le build ARM64 locali aumentata dall’85% al 90%, mantenendo configurabile il limite esplicito.

### Fixed

- salvataggio canonico bidirezionale e riordino o rimozione delle occorrenze ripetibili senza perdita d’identità;
- aggiornamento deterministico dei valori automatici e rifiuto dei conflitti di revisione senza sovrascritture silenziose.

## 0.1.8

### Changed

- pubblicazione end-to-end accelerata con immagine ARM64 su GHCR per digest, manifest leggero e pull diretto sulla VPS;
- Chromium e WebKit eseguiti in parallelo e in ambienti isolati fissati per digest;
- preflight locale exact-HEAD riusabile tramite ricevuta esterna legata a tree, lockfile, toolchain e comandi;
- classificazione operativa ricalcolata dopo il merge e dopo eventuali Production concorrenti, evitando candidate ridondanti;
- scansione dell'immagine eseguita nello stesso job ARM64 che la produce, prima della pubblicazione;
- tag e GitHub Release creati e riletti automaticamente dopo un deploy riuscito;
- suite pubblica della PR riusata dalla candidata solo a parità di albero Git e gate richiesti verdi;
- job pesanti non ripetuti sul push dello squash a `main`;
- bump di sola versione escluso dai gate ARM64 quando il confronto strutturale dei package file lo prova;
- pulizia Docker ordinaria rimossa dal percorso critico e demandata al timer selettivo.

### Fixed

- controllo della versione release compatibile sia con l'HEAD della PR sia con lo SHA squash di `origin/main` dopo il merge.
- container browser predisposti alla compilazione delle dipendenze native richiesta dalla toolchain fissata dal progetto.

## 0.1.7

### Changed

- navigazione della Vista Quadri semplificata rimuovendo i rapporti tecnici fra etichette verificate e campi compilabili;
- testi del catalogo mostrati con accenti e apostrofi italiani corretti, senza alterare valori tecnici o fonti ufficiali grezze.

### Fixed

- matrice versionata di parità operativa riallineata alla generazione deterministica corrente per i campi EF6 ed EF12.

## 0.1.6

### Added

- matrice deterministica di parità tra i 715 campi ufficiali della vista Quadri e le corrispondenti aree della vista operativa, con coperture complete, parziali e mancanti esplicitamente classificate;
- campi ufficiali modificabili anche nella vista operativa, organizzati nelle otto aree di lavoro e salvati sullo stesso modello canonico della vista Quadri.

### Changed

- workspace della pratica disposto su una sola colonna informativa, con fonti, situazione e riferimenti collocati sotto il contenuto pertinente;
- navigazione delle sezioni su mobile trasformata in un menu chiuso di default;
- azioni, box di riepilogo, spaziature e testi responsive uniformati su desktop e mobile.

## 0.1.5

### Added

- rinomina persistente della pratica dal menu Azioni, conservando la sezione e la vista correnti.

### Changed

- intestazione della pratica più compatta e responsiva, senza il collegamento Dashboard duplicato né il contatore tecnico di revisione.

### Fixed

- sfondo delle finestre modali reso neutro, senza dominante blu;
- pulizia delle immagini Docker Production rinviata fino al completamento del readback e del rollback qualificato.

## 0.1.4

### Added

- controllo pubblico dedicato allo spazio del filesystem dei dati, degradato sotto 5 GiB liberi o dal 90% di utilizzo.

### Security

- health pubblico ridotto al solo stato generico, con identità dell’immagine e del commit verificata esclusivamente dalla procedura di deploy sulla VPS;
- runtime Production senza capability aggiuntive, file setuid/setgid o profili seccomp e AppArmor disabilitati, finché Codex resta spento.

## 0.1.3

### Fixed

- ricerca mobile centrata, compatta e richiudibile senza occupare l’intero schermo;
- barra di navigazione inferiore ridotta e spaziatura mobile corretta per scadenze e menu del workspace;
- logo collegato alla Dashboard su tutte le superfici autenticate e sugli stati di errore;
- checkbox e relative etichette riallineate su desktop e mobile.

## 0.1.2

### Fixed

- download del fac-simile escluso dalla navigazione client, evitando errori console pur conservando il nome file fornito dalla risposta PDF.

## 0.1.1

### Fixed

- apertura del fac-simile PDF in una nuova scheda del browser, mantenendo separata l’azione di download.

## 0.1.0

### Added

- policy numerica di versioning fino alla prima major stabile, con mappa tra fasi del Master Plan e release, divieto di suffissi prerelease/build e regole per minor, patch e validazione finale;
- compatibilità browser production-ready per l'istanza privata: titoli contestuali, metadati installabili, tema della chrome sincronizzato e asset dedicati per favicon, Safari e collegamenti Apple, mantenendo l'app non indicizzabile;
- prima release stabile per l’uso personale sulla VPS, con hostname HTTPS dedicato, autenticazione dell’owner, runtime ARM64 isolato, proxy Caddy condiviso senza accesso ai dati Hub Fatture e procedure di deploy, rollback, backup e ripristino qualificate;
- pubblicazione intermedia del dominio della pratica e della dichiarazione, con campi ufficiali organizzati per Quadri, devoluzione assistita, prima catena di calcolo, ricerca di dominio e riepilogo PDF/JSON; la chiusura della conformità resta esplicitamente bloccata fino alla riconciliazione completa delle fonti;
- pacchetto versionato delle fonti ministeriali pubbliche, comprensivo di manifest verificabile, albero XSD, fonti normative e operative, Desktop Telematico per macOS e modulo di controllo SUC13 conservato tramite Git LFS;
- bootstrap VPS-first e layout separato;
- gate riproducibile per il source bundle ufficiale;
- scheletro del catalogo derivato e del DIZ Lab;
- CI pubblica senza dati reali o fonti riservate;
- governance GitHub completa e supply-chain pinning;
- target amministrativo e identificatori dell'host rimossi dal repository pubblico e spostati nella configurazione VPS privata;
- policy per Svelte Doctor come required check bloccante, salvo falsi positivi soppressi puntualmente e motivati.
- governance documentale con fonti uniche per metadati ufficiali, versioni tecniche e sequenza di implementazione.
- fondazioni applicative SvelteKit con autenticazione, SQLite, blob store, job persistenti, backup di base e runtime ARM64 isolato;
- Brand Foundation, asset SVG nativi, shell responsive, Dashboard operativa, ricerca, upload e workspace minimo;
- toolchain corrente e di rollback qualificata, smoke della release identificata e matrice E2E Chromium/WebKit.
- pubblicazione GitHub proporzionata con classificazione conservativa, gate aggregatore, orchestrazione e polling Codex adattivo;
- P2/P3 Codex registrati come advisory, thread automatici risolti in sicurezza e artefatto ARM64 di release riutilizzabile per digest.
- contratto `Pubblica` allineato a Hub Fatture: ciclo tecnico completo quando applicabile, governance senza deploy e prima attivazione separata.
- build Docker temporanee sulla VPS serializzate, bloccate senza margine disco e ripulite automaticamente; retention selettiva con runtime, rollback e container in uso sempre protetti.
- build Docker ARM64 locali confinate a un wrapper con soglia disco, due soli tag correnti e TRIM automatico di Colima; policy BuildKit GC locale resa riproducibile con budget di cache a 8 GB.
