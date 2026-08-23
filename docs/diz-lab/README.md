# DIZ Lab

Il laboratorio DIZ precede l'applicazione completa. I campioni reali risiedono esclusivamente in `/opt/sequent/private/diz-lab/corpus/`; nel repository possono entrare soltanto fixture sintetiche non riconducibili a clienti.

## Inventario privato

Ogni campione registra fuori da Git: hash, dimensione, provenienza legittima, versione di SuccessioniOnLine, piattaforma, tipo dichiarazione, allegati disponibili e autorizzazione d'uso per interoperabilità.

## Sequenza

1. acquisire coppie differenziali con una sola modifica;
2. classificare firma e contenitore senza estrarre in-place;
3. confrontare struttura, checksum, metadati e percorsi;
4. costruire parser read-only con preservazione dei blocchi sconosciuti;
5. produrre writer soltanto su fixture sintetiche;
6. provare apertura, salvataggio e telematico in SuccessioniOnLine su macOS e Windows;
7. eseguire confronto a tre vie e registrare le divergenze.

## Arresto

Il lavoro si ferma prima di decompilazione non strettamente necessaria, redistribuzione di componenti protetti, perdita di blocchi sconosciuti o scrittura non affidabile. In tali casi si apre il Decision Gate sul componente locale/Java minimo.
