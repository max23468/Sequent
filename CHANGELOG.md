# Changelog

Tutte le modifiche rilevanti di Sequent sono documentate in questo file.

## Unreleased

## 0.2.0

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
