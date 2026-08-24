# DIZ Lab

Il laboratorio DIZ precede l'applicazione completa. I campioni reali risiedono esclusivamente in `/opt/sequent/private/diz-lab/corpus/`; nel repository possono entrare soltanto fixture sintetiche non riconducibili a clienti.

## Inventario privato

Ogni campione registra fuori da Git: hash, dimensione, provenienza legittima, versione di SuccessioniOnLine, piattaforma, tipo dichiarazione, allegati disponibili e autorizzazione d'uso per interoperabilità.

L'inventario si genera con `npm run diz:inventory -- <corpus> --authorized-on <AAAA-MM-GG> --output <inventario.json>`. La data esplicita impedisce allo strumento di attestare autonomamente un'autorizzazione mai ricevuta. Il comando scrive atomicamente un JSON privato con permessi `0600` e non stampa nomi di file o dati fiscali sul terminale.

Quando alcuni campioni hanno completato il ciclo ufficiale, la stessa esecuzione registra il contesto con `--round-trip-samples <sample-01,sample-02> --qualification-on <AAAA-MM-GG> --qualification-platform <piattaforma> --qualification-software <software> --qualification-version <versione>`. Piattaforma e versione di origine non vengono inventate quando il DIZ non le codifica: l'inventario le marca esplicitamente come non disponibili e distingue i campioni verificati soltanto dal parser da quelli qualificati nel software ufficiale. Il tipo di dichiarazione resta non qualificato finché il mapping del frontespizio non viene chiuso in `TG-COMPLIANCE`.

## Strumenti versionati

- `npm run diz:inspect -- <file.diz>` valida contenitore ZIP, CRC, limiti di espansione, XML XStream, percorsi e riferimenti agli allegati, restituendo soltanto un riepilogo privo del nome fiscale del file;
- `npm run diz:compare -- <base.diz> <corrente.diz> <ufficiale.diz>` esegue il confronto a tre vie senza stampare nomi di file o valori fiscali;
- il parser read-only espone campi tramite localizzatori `quadro/modulo/campo` e conserva sorgente, entry e metadati non interpretati;
- il writer richiede valore base atteso e mapping qualificato collegato a `SRC-08`, applica i vincoli del campo presenti nel catalogo e restituisce gli stessi byte per un no-op; se il DIZ contiene allegati, la riscrittura richiede inoltre evidenza per hash di un precedente controllo ufficiale PDF/A/TIFF e blocca formati non ammessi o file oltre 5 MiB;
- il confronto a tre vie separa modifiche ufficiali qualificate, modifiche locali, conflitti e campi opachi senza scegliere automaticamente in caso di divergenza; blocca inoltre la riconciliazione se cambiano i blocchi XML opachi o gli allegati;

Il registro di produzione accetta soltanto mapping dimostrati da una coppia differenziale a campo singolo, verificati mediante apertura e salvataggio nell'applicazione ufficiale e collegati a un percorso del catalogo derivato da `SRC-08`. Le normalizzazioni interne prive di corrispondenza nel catalogo ufficiale restano dati opachi da preservare e non diventano automaticamente campi scrivibili.

## Sequenza

1. acquisire coppie differenziali con una sola modifica;
2. classificare firma e contenitore senza estrarre in-place;
3. confrontare struttura, checksum, metadati e percorsi;
4. costruire parser read-only con preservazione dei blocchi sconosciuti;
5. produrre writer soltanto su fixture sintetiche;
6. provare apertura, salvataggio e telematico in SuccessioniOnLine su macOS;
7. eseguire confronto a tre vie e registrare le divergenze.

Il laboratorio deve inoltre verificare deterministicamente che il DIZ non dipenda da percorsi assoluti, separatori, codifiche, terminatori di riga o metadati specifici del sistema operativo. A sviluppo concluso, se è già disponibile un ambiente Windows, il ciclo può essere ripetuto come collaudo facoltativo e advisory: non richiede una VM dedicata e la sua mancata esecuzione non blocca `TG-DIZ`, fasi di implementazione o release. Una divergenza DIZ riproducibile e confermata segue invece i criteri di arresto e blocca l'output interessato.

## Arresto

Il lavoro si ferma prima di decompilazione non strettamente necessaria, redistribuzione di componenti protetti, perdita di blocchi sconosciuti o scrittura non affidabile. In tali casi si apre il Decision Gate sul componente locale/Java minimo.
