# Piano eseguibile TG-COMPLIANCE

- [x] Estrarre deterministicamente inventario campi e struttura XSD mantenendo i percorsi originali.
- [x] Curare modello visibile e istruzioni con riferimenti a pagina, sezione e rigo.
- [x] Riconciliare ogni voce di `SRC-01`, `SRC-02` e `SRC-09`; risolvere esplicitamente `SRC-09-n` e `SRC-09-q`.
- [x] Trasformare `SRC-10` in golden test con tutti i valori intermedi della catena `QE → ISN`.
- [x] Riconciliare `SRC-11`–`SRC-14` con modello, calcoli, scadenze, pagamenti e codici tributo.
- [x] Costruire da `SRC-16`–`SRC-22` la linea temporale articolo per articolo e selezionarla con la data di apertura della successione.
- [x] Versionare e testare interessi e coefficienti annuali da `SRC-23`–`SRC-26`; aggiungere il caso storico richiesto da `SRC-27`.
- [x] Qualificare la versione corrente di SUC13, allegati, ricevute, modello cartaceo e archivi correnti usando `SRC-15` e `SRC-28`–`SRC-31` nei limiti del rispettivo ruolo; confrontare con il canale vivo programmi, manuali e deposito del controllo conservati in `SRC-32`–`SRC-40`.
- [x] Generare catalogo, validator e report di copertura da un’unica pipeline.
- [x] Bloccare su elementi irrisolti, provenienza mancante, periodo non determinato o divergenza fra norma, modello, istruzioni e XSD.
- [x] Chiudere il gate soltanto dopo review deterministica e suite di conformità alle fonti ufficiali verde.
