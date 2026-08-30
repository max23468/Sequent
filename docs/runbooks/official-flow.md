# Flusso ufficiale

La sezione **Invio e ricevute** della pratica conserva separatamente ogni passaggio del ciclo ufficiale. La capacità DIZ deve essere abilitata nella configurazione privata; l’abilitazione non sostituisce i controlli di conformità della singola dichiarazione.

## DIZ e confronto a tre vie

1. acquisire il DIZ qualificato usato come base; Sequent crea prima uno snapshot della dichiarazione e non applica dati privi di mapping qualificato;
2. completare i controlli interni e preparare gli allegati finali;
3. generare e scaricare il DIZ;
4. aprirlo in SuccessioniOnLine, salvarlo ed eseguire il controllo obbligatorio Agenzia/Sogei;
5. reimportare il DIZ salvato nello stesso ciclo di export;
6. scegliere esplicitamente il lato da conservare per ogni conflitto; modifiche opache e campi senza mapping restano preservati ma non vengono promossi nel modello canonico.

Ogni export conserva revisione di base, report di conformità e impronta della parte opaca. Un nuovo ciclo non sovrascrive gli artefatti precedenti e non può iniziare finché il ciclo corrente non è stato reimportato e riconciliato. Il confronto rende esplicita anche ogni variazione dell’impronta opaca o degli allegati, senza promuoverla nel modello canonico.

## Telematico, ricevute ed esiti

Telematico, diagnostici, stampa, ricevute, quietanze ed esiti delle volture vengono caricati con il tipo corrispondente. La prima ricevuta documenta soltanto la trasmissione. Lo stato di presentazione richiede una seconda ricevuta positiva, data ed estremi di registrazione. Soltanto quando il file non è ottenibile, l’owner può registrare una conferma manuale motivata con gli stessi estremi ufficiali. La prima transizione a `Presentata` e la prima chiusura producono ciascuna uno snapshot immutabile della dichiarazione. Un esito volture parziale o negativo non chiude il fascicolo.

Lo stato viene derivato dagli eventi. Una correzione manuale resta separata dagli artefatti, richiede una motivazione ed entra nell’audit; non può promuovere la pratica a `Presentata`, `Volture in lavorazione` o `Chiusa` senza la rispettiva evidenza ufficiale.

I file sono serviti soltanto all’owner autenticato, con cache disabilitata, e rientrano nel backup manuale insieme agli snapshot e all’audit essenziale.

## Confini operativi

Il flusso non invia file all’Agenzia, non avvia SuccessioniOnLine e non deduce l’esito di una ricevuta dal nome del file. L’eventuale controllo Windows resta advisory; una divergenza DIZ riproducibile resta invece bloccante. Hostname, Caddy, Dynu, firewall, attivazione e deploy seguono i rispettivi runbook e richiedono l’autorizzazione prevista dal Master Plan.
