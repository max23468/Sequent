# Piano eseguibile TG-COMPLIANCE

1. Estrarre deterministicamente inventario campi e struttura XSD mantenendo i percorsi originali.
2. Curare modello visibile e istruzioni con riferimenti a pagina, sezione e rigo.
3. Riconciliare ogni voce di `SRC-01`, `SRC-02` e `SRC-09`; risolvere esplicitamente `SRC-09-n` e `SRC-09-q`.
4. Trasformare `SRC-10` in golden test con tutti i valori intermedi della catena `QE → ISN`.
5. Riconciliare `SRC-11`–`SRC-14` con modello, calcoli, scadenze, pagamenti e codici tributo.
6. Costruire da `SRC-16`–`SRC-22` la linea temporale articolo per articolo e selezionarla con la data di apertura della successione.
7. Versionare e testare interessi e coefficienti annuali da `SRC-23`–`SRC-26`; aggiungere il caso storico richiesto da `SRC-27`.
8. Qualificare la versione corrente di SUC13, allegati, ricevute, modello cartaceo e archivi correnti usando `SRC-15` e `SRC-28`–`SRC-31` nei limiti del rispettivo ruolo; confrontare con il canale vivo programmi, manuali e deposito del controllo conservati in `SRC-32`–`SRC-40`.
9. Generare catalogo, validator e report coverage da un'unica pipeline.
10. Bloccare su elementi `unresolved`, provenienza mancante, periodo non determinato o divergenza fra norma, modello, istruzioni e XSD.
11. Chiudere il gate soltanto dopo review deterministica e suite di conformità alle fonti ufficiali verde.
