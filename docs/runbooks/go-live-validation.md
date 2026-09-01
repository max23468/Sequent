# Validazione finale e go-live

Questa procedura ricostruisce il corpus storico, aggrega il benchmark di sicurezza e raccoglie le prove operative richieste dal Technical Gate finale. Non autorizza invii telematici, deploy, release o modifiche ai dati operativi. Le pratiche, i risultati attesi e i dettagli per campo restano in una directory privata sulla VPS e non entrano in Git, CI, log o artefatti pubblici.

## Confini

- lavorare dalla release candidata identificata da commit completo;
- usare una copia ripristinata e isolata dei dati per preparazione, regressioni e prove rischiose;
- derivare il risultato atteso dalla dichiarazione effettivamente presentata e dalle correzioni professionali oppure, quando l’owner ne conferma la completezza, dal DIZ conclusivo archiviato; mai da una nuova interpretazione automatica;
- usare identificativi neutri nel file privato e non stampare nomi, codici fiscali, valori, estratti o percorsi del corpus;
- conservare input e report con directory `0700` e file `0600`;
- lasciare ogni divergenza critica aperta come blocker esplicito;
- acquisire l’approvazione dell’owner soltanto dopo la riconciliazione della pratica reale parallela.

## Corpus storico

Selezionare da cinque a dieci pratiche concluse. Il corpus deve coprire i periodi temporali e il caso storico indicati nel Master Plan. Per ogni pratica:

1. ricostruire il fascicolo completo in Sequent;
2. classificare separatamente i documenti secondo le categorie del benchmark;
3. confrontare campi, fonti, conflitti, calcoli, output e controlli con l’esito effettivamente presentato;
4. registrare zero divergenze critiche irrisolte e zero regressioni critiche;
5. eseguire più run quando la variabilità di Codex rende insufficiente una singola esecuzione;
6. mantenere dati attesi e osservati soltanto nel file privato di qualifica.

Per i cinque DIZ acquisiti nella fase precedente, la conferma dell’owner che si tratta di pratiche complete consente di usare l’originale archiviato come esito atteso (`owner_confirmed_complete_diz`). Questa conferma non sostituisce ricostruzione, benchmark e riconciliazione né colma da sola la copertura temporale richiesta.

Ogni `benchmarkRuns` usa lo stesso formato accettato da `npm run benchmark:extraction-safety`. Le pratiche reali possono includere più dataset o più run; il report pubblico non contiene identificativi né risultati per campo.

## Prove operative

Il file privato include ricevute legate allo stesso commit per:

- bundle e catalogo ufficiale verificati, senza elementi rilevanti irrisolti;
- pacchetto sintetico accettato dal controllo ufficiale;
- Safari e Chrome su macOS, Chrome ed Edge su Windows e Safari su iPhone/iPad, con almeno un ciclo manuale su browser e sistema reali;
- backup verificato, restore isolato e readback degli artefatti;
- health HTTPS della candidata;
- prima pratica reale lavorata in parallelo, attraversando caricamento, elaborazione, Codex, revisione, devoluzione, calcoli, checklist, DIZ, SuccessioniOnLine, telematico/ricevute e chiusura.

La mera presenza dei cinque DIZ acquisiti nella fase precedente non qualifica il corpus storico: servono date di apertura, risultato atteso, ricostruzione completa e riconciliazione.

## Esecuzione

Preparare il file JSON fuori dal checkout, limitarne i permessi e indicare un percorso di report distinto:

```bash
chmod 600 /percorso/privato/input.json
SEQUENT_COMMIT_SHA=<sha-completo> npm run qualify:go-live -- \
  --input /percorso/privato/input.json \
  --output /percorso/privato/report.json
```

Il comando:

- rifiuta input assente, link simbolici, permessi di gruppo/altri e collisione input/output;
- rifiuta ricevute prodotte su un commit diverso;
- aggrega soltanto conteggi e categorie sanitizzati;
- scrive il report a `0600` e stampa unicamente stato e numero di blocker;
- termina con errore finché il gate tecnico e l’approvazione finale non sono entrambi completi.

La chiusura richiede la rilettura del report privato, dell’esatto candidato, dei gate di release e dello stato live. Solo una successiva richiesta affermativa di pubblicazione autorizza il ciclo tecnico di release e deploy previsto dalle regole del repository.
