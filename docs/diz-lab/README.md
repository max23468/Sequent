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
6. provare apertura, salvataggio e telematico in SuccessioniOnLine su macOS;
7. eseguire confronto a tre vie e registrare le divergenze.

Il laboratorio deve inoltre verificare deterministicamente che il DIZ non dipenda da percorsi assoluti, separatori, codifiche, terminatori di riga o metadati specifici del sistema operativo. A sviluppo concluso, se è già disponibile un ambiente Windows, il ciclo può essere ripetuto come collaudo facoltativo e advisory: non richiede una VM dedicata e la sua mancata esecuzione non blocca `TG-DIZ`, fasi di implementazione o release. Una divergenza DIZ riproducibile e confermata segue invece i criteri di arresto e blocca l'output interessato.

## Arresto

Il lavoro si ferma prima di decompilazione non strettamente necessaria, redistribuzione di componenti protetti, perdita di blocchi sconosciuti o scrittura non affidabile. In tali casi si apre il Decision Gate sul componente locale/Java minimo.
