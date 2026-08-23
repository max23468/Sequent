# Piano eseguibile TG-COMPLIANCE

1. Estrarre deterministicamente inventario campi e struttura XSD mantenendo i percorsi originali.
2. Curare modello visibile e istruzioni con riferimenti a pagina, sezione e rigo.
3. Riconciliare ogni voce di `SRC-01`, `SRC-02` e `SRC-09`; risolvere esplicitamente `SRC-09-n` e `SRC-09-q`.
4. Trasformare `SRC-10` in golden test con tutti i valori intermedi della catena `QE → ISN`.
5. Generare catalogo, validator e report coverage da un'unica pipeline.
6. Bloccare su elementi `unresolved`, provenance mancante o divergenza fra modello, istruzioni e XSD.
7. Chiudere il gate soltanto dopo review deterministica e suite della sezione 48.10 verde.
