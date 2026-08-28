# Debian 13 Slim per l’immagine applicativa

**Stato:** accettata; sostituisce ADR 0001.

## Contesto

Sequent distribuisce un solo container ARM64 che combina Node, dipendenze native, conversioni Office e PDF, OCRmyPDF in un ambiente Python isolato e la CLI Codex. La base Alpine richiedeva un runtime musl e `gcompat`, mentre alcune dipendenze native e wheel Python hanno un percorso primario glibc. La scelta della distribuzione deve inoltre restare aggiornabile tramite pull request, riproducibile e compatibile con la policy che blocca ogni vulnerabilità correggibile e conserva come advisory esplicite quelle senza fix distribuibile.

La VPS condivisa resta Ubuntu: questa decisione riguarda esclusivamente gli stage dell’immagine applicativa e non modifica host, networking o servizi esterni.

## Decisione

- tutti gli stage applicativi derivano da un unico stage `node-base`, dichiarato con una riga `FROM` diretta sull’immagine ufficiale Node `trixie-slim` fissata per digest OCI; Dockerfile e manifest eseguibili restano le fonti delle versioni esatte;
- il manifest OCI deve includere `linux/arm64`; la build canonica locale continua a usare `npm run image:local` e la candidata pubblica continua a costruire una sola immagine ARM64;
- il runtime usa glibc di Debian 13; non esistono variante Alpine, fallback musl o layer di compatibilità `gcompat`;
- i pacchetti APT provengono dall’unico snapshot Debian immutabile `20260827T000000Z`, scelto perché include gli aggiornamenti di sicurezza pubblicati dopo lo snapshot incorporato nella base ufficiale. Le firme dell’archivio Debian restano obbligatorie e `Check-Valid-Until` viene disabilitato soltanto perché lo snapshot è intenzionalmente storico;
- la build non esegue `apt upgrade` o `dist-upgrade`: una nuova base entra soltanto tramite un nuovo digest verificato; gli indici APT vengono rimossi nello stesso layer dell’installazione e si usa sempre `--no-install-recommends`;
- OCRmyPDF resta nel venv `/opt/ocr`, costruito e consumato su ABI glibc compatibile. Compiler, header e `python3-venv` restano fuori dallo stage finale;
- Node e npm restano fissati dai manifest eseguibili, inclusa la versione npm esposta dal runtime finale;
- Dependabot controlla settimanalmente l’ecosistema Docker e propone gli aggiornamenti del digest. Runtime, toolchain e OCR richiedono comunque valutazione deliberata e non ricevono auto-merge indiscriminato.

## Alternative scartate

- **Mantenere Alpine:** conserverebbe musl e `gcompat` e duplicherebbe il percorso di compatibilità che questa decisione elimina.
- **Stage misti Alpine/Debian:** renderebbero il venv OCR e le dipendenze native dipendenti da ABI diverse.
- **Debian non Slim:** aggiungerebbe strumenti e pacchetti non necessari allo stage finale.
- **Repository Debian mobili:** renderebbero due build dello stesso commit dipendenti dal momento di risoluzione APT.
- **Immagine distroless:** non contiene la toolchain documentale e i prerequisiti necessari ai processi figli di Sequent.

## Conseguenze

L’immagine può cambiare dimensione e inventario di vulnerabilità rispetto ad Alpine; il confronto è informativo per dimensione e prestazioni, mentre ogni vulnerabilità con fix disponibile resta bloccante. Le vulnerabilità senza fix, incluse quelle Critical, sono un rischio accettato dal proprietario e restano visibili per severità e identificativo fino all’aggiornamento della base o del pacchetto. I nomi dei pacchetti seguono Debian, ma le capacità documentali restano equivalenti. Il runtime ordinario continua come `10001:10001`, con filesystem in sola lettura, un solo launcher Codex setuid controllato, percorso vendor non scrivibile e nessun tool di compilazione.

LibreOffice usa i pacchetti `core`, `calc` e `writer` headless di Debian, evitando le dipendenze GUI non necessarie al runtime. Il rollback usa l’archivio ARM64 e il manifest immutabile della candidata precedente, senza ricostruire l’immagine e senza toccare dati o schema.
