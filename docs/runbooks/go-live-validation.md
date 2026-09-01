# Validazione finale e go-live

Questa procedura raccoglie le prove private richieste dal Technical Gate finale. Non autorizza invii telematici, deploy, release o modifiche ai dati operativi. I dettagli delle pratiche restano in una directory privata sulla VPS e non entrano in Git, CI, log o artefatti pubblici.

## Decisione sulla soglia finale

La soglia canonica di `TG-GOLIVE` non rende bloccanti la ricostruzione end-to-end estesa dei fascicoli, il benchmark storico esteso, la matrice manuale su tutti i sistemi target e una nuova pratica lavorata in parallelo. Queste attività restano utili durante l’uso ordinario, ma la loro assenza non viene rappresentata come evidenza eseguita.

La soglia approvata richiede invece:

- cinque DIZ privati unici, confermati completi dall’owner, acquisiti e riletti sul candidato esatto;
- copertura del primo anno dell’autoliquidazione indicato dal Master Plan, senza quote obbligatorie per annualità successive o per una decisione normativa specifica;
- zero divergenze critiche irrisolte nell’acquisizione del corpus;
- bundle e catalogo ufficiale qualificati, senza elementi rilevanti irrisolti;
- pacchetto sintetico accettato dal controllo ufficiale;
- backup verificato, restore isolato e readback degli artefatti;
- health HTTPS della candidata;
- approvazione finale dell’owner.

## Confini

- lavorare dalla release stabile candidata identificata da commit completo;
- usare una copia ripristinata e isolata dei dati per prove rischiose;
- usare identificativi neutri nel file privato e non stampare nomi, codici fiscali, valori, estratti o percorsi del corpus;
- conservare input e report con directory `0700` e file `0600`;
- lasciare ogni divergenza critica aperta come blocker esplicito;
- non trasformare le attività non più bloccanti in prove fittizie.

## Esecuzione

Preparare il file JSON fuori dal checkout, limitarne i permessi e indicare un percorso di report distinto:

```bash
chmod 600 /percorso/privato/input.json
SEQUENT_COMMIT_SHA=<sha-completo> npm run qualify:go-live -- \
  --input /percorso/privato/input.json \
  --output /percorso/privato/report.json
```

Il formato privato corrente registra la candidata stabile, le date di apertura e i conteggi del corpus DIZ, la conformità ufficiale, il backup/restore e l’approvazione. La copertura temporale viene derivata dalle date private, non da un booleano compilato manualmente. Ogni ricevuta tecnica deve riferirsi allo stesso commit e riportare il proprio timestamp; l’approvazione finale è valida soltanto se successiva a tutte le prove tecniche.

Il comando:

- rifiuta input assente, link simbolici, permessi di gruppo/altri e collisione input/output;
- rifiuta ricevute prodotte su un commit diverso;
- aggrega soltanto conteggi sanitizzati;
- scrive il report a `0600` e stampa unicamente stato e numero di blocker;
- termina con errore finché il gate tecnico e l’approvazione finale non sono entrambi completi.

La chiusura richiede la rilettura del report privato, dell’esatto candidato, dei gate di release e dello stato live. Solo una successiva richiesta affermativa di pubblicazione autorizza il ciclo tecnico di release e deploy previsto dalle regole del repository.

## Sequenza di chiusura

La pubblicazione della candidata stabile non chiude da sola il gate. Dopo il deploy riuscito occorre:

1. rileggere tag, GitHub Release, deployment, immagine attiva, commit e health HTTPS;
2. rigenerare sul commit finale il report del corpus DIZ;
3. creare e verificare un nuovo backup, ripristinarlo in una directory isolata e rileggere database e artefatti;
4. riconfermare bundle, catalogo e controllo ufficiale sullo stesso commit;
5. preparare l’input privato con le cinque date di apertura e le ricevute exact-commit;
6. acquisire l’approvazione finale dell’owner dopo la rilettura tecnica;
7. generare e rileggere il report `TG-GOLIVE` senza blocker;
8. registrare nel capitolo canonico del Master Plan lo stato chiuso, la release e il commit esatti mediante una modifica esclusivamente documentale.
