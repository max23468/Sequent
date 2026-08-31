# Qualificazione Codex e corpus DIZ

Questa procedura qualifica Codex attraverso Sequent e acquisisce i cinque DIZ già presenti nel corpus privato. Non ridefinisce mapping, round-trip, backup, health o deploy già qualificati e non autorizza una release. Dati, nomi, output Codex e report dettagliati restano sulla VPS, fuori da Git, CI e artefatti pubblici.

## Prerequisiti e confini

- il flusso ufficiale e le operations devono essere chiusi sull'HEAD esatto candidato;
- `SEQUENT_DIZ_ENABLED=true` e origine HTTPS devono risultare già qualificate;
- Codex parte da `SEQUENT_CODEX_ENABLED=false` e usa soltanto `/var/lib/sequent/.codex-sequent`;
- la home dedicata non contiene `config.toml`, `requirements.toml` o `plugins` e non usa API key;
- attivazione della flag, deploy, restart deliberati e reautenticazione richiedono la finestra operativa autorizzata;
- l'archivio operativo non viene mai aperto dalla working tree: i comandi girano nella release identificata.

## Qualificazione Codex

1. Dalla release candidata, entrare nel container come utente applicativo e avviare il comando amministrativo vincolato alla sola home dedicata:

   ```bash
   npm run admin:connect-codex
   ```

   Il comando crea la directory privata con modalità `0700`, forza `CODEX_HOME` sul percorso dedicato, non eredita eventuali API key e verifica esplicitamente l’accesso tramite ChatGPT. Per il solo readback successivo usare `npm run admin:connect-codex -- --status-only`. Una sessione presente nella home amministrativa generale non viene accettata né copiata.

2. Applicare `SEQUENT_CODEX_ENABLED=true` soltanto attraverso il configuratore installato e il deploy deliberato della release qualificata.
3. Nel container della release eseguire il controllo sintetico, scrivendo il risultato sanitizzato in una directory privata:

   ```bash
   npm run qualify:codex-runtime -- --output /var/lib/sequent/qualification/codex.json
   ```

   Il comando usa il vero SDK e la vera sessione ChatGPT, ma crea database, pratica, documento testuale e immagine neutra sintetici sotto `/tmp`; verifica input immagine, output strutturato, provenienza letterale, persistenza del thread nel database temporaneo e benchmark fail-closed, poi rimuove il workspace. Crea la directory privata del report con permessi `0700`, forza il file a `0600` e rifiuta esecuzioni non legate allo SHA completo della release. Non stampa contenuti o credenziali.

4. Nell'app creare una pratica sintetica controllata, elaborare un documento testuale e un'immagine controllata, quindi avviare una run. Rileggere proposte, fonti e stato; riavviare il container attraverso la corsia operativa, rileggere la stessa run e avviare una seconda analisi che riprenda il thread persistito.
5. Verificare l'indisponibilità controllata con la flag spenta e, in una finestra concordata, completare logout e nuovo device login della sola home dedicata. Non cancellare o sostituire la sessione amministrativa generale.

Un timeout, una fonte non letterale, un valore inventato, una API key, un plugin/configurazione estranea o la perdita del thread blocca `TG-CODEX`.

## Acquisizione dei cinque DIZ

Per ogni file del corpus privato:

1. creare o collegare la pratica corretta;
2. predisporre nello stesso ordine le posizioni del Quadro EA necessarie al mapping qualificato;
3. acquisire il DIZ dalla sezione **Invio e ricevute**;
4. verificare i valori importati in `Da verificare`; ogni divergenza con un valore già presente resta esplicita e non viene sovrascritta;
5. lasciare invariati originali, allegati e campi privi di mapping qualificato.

Al termine, dalla release attiva eseguire il readback privato:

```bash
npm run qualify:diz-corpus -- \
  --corpus /opt/sequent/private \
  --data-dir /var/lib/sequent \
  --output /var/lib/sequent/qualification/diz-corpus.json
```

Il comando richiede esattamente cinque DIZ univoci, associa ciascun hash ad almeno un’acquisizione attiva e completa, rilegge il blob, ripete il parsing e verifica metadati, contenuti opachi e ogni campo acquisibile nel modello canonico, inclusi soggetti e cespiti multipli nello stesso modulo. Eventuali tentativi incompleti precedenti restano nella cronologia senza impedire la prova dell’acquisizione corretta più recente. Il controllo fallisce se manca una posizione, resta una divergenza, i metadati non coincidono, un allegato incorporato non è materializzato o un file è diverso. Il report contiene soltanto conteggi sanitizzati, è legato allo SHA completo della release e viene scritto con directory `0700` e file `0600`.

Per aggiornare acquisizioni create con una mappatura precedente, verificare prima il backup operativo e usare la riparazione dalla scheda **Flusso ufficiale**. In alternativa, la procedura amministrativa bulk richiede deliberatamente `--apply` e il numero esatto di pratiche attese:

```bash
npm run admin:repair-diz -- --data-dir /percorso/dati --expected-count 5 --apply
```

La riparazione non modifica i byte del DIZ: crea uno snapshot, integra soltanto campi mancanti, conserva le divergenze, riusa i target già legati e rimaterializza per hash gli allegati incorporati.

## Chiusura della qualificazione

Prima di proporre la chiusura della qualificazione corrente:

- eseguire backup e restore su copia isolata dopo l'acquisizione;
- verificare health HTTPS e assenza di dati reali in Git, CI e artefatti;
- rileggere i due report privati, la run dopo restart e lo stato ChatGPT;
- lasciare la pratica sintetica separata dai cinque fascicoli reali e rimuoverla solo dopo avere conservato la prova tecnica necessaria;
- ottenere l'approvazione dell'owner. Il benchmark storico completo, la prima pratica reale parallela e la release stabile appartengono alla fase successiva.
