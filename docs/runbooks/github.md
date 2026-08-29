# Runbook GitHub

## Profilo del repository

`max23468/Sequent` è un repository pubblico proprietario, senza licenza. `main` è il branch permanente e si integra esclusivamente tramite pull request e squash merge; i branch temporanei vengono eliminati dopo il merge.

Issues, Projects e Wiki restano disabilitati. GitHub Actions usa permessi predefiniti di sola lettura, non può approvare pull request, ammette soltanto azioni GitHub-owned e richiede riferimenti immutabili per SHA. Secret scanning, push protection, Dependabot security updates, vulnerability alerts e private vulnerability reporting devono restare attivi.

## Required checks

La ruleset `main protection`, senza bypass, richiede HEAD aggiornato, conversazioni risolte e questi controlli:

- `Foundation`;
- `Dependency review`;
- `Analyze (javascript-typescript)`;
- `PR gate`.

La ruleset vieta eliminazione e non-fast-forward di `main`, consente soltanto squash merge, invalida le review obsolete e richiede approvazione aggiuntiva per modifiche non attribuite.

## Gate proporzionati

`scripts/github/publication-policy.mjs` classifica la diff come rapida, ordinaria o sensibile. Una diff sconosciuta o vuota usa il livello sensibile. `PR gate` è sempre presente e richiede i risultati pertinenti; un job richiesto ma saltato, cancellato o mancante blocca il merge.

- rapido: documentazione, formato, test della governance e confine pubblico;
- ordinario: gate rapidi, lint, typecheck, test, build e Svelte Doctor;
- sensibile: livello ordinario più browser e/o ARM64 secondo il confine toccato;
- release: matrice completa, benchmark e artefatto ARM64 verificato.

Svelte Doctor gira una sola volta come job in sola lettura sulle PR ordinarie e sensibili. Il risultato confluisce in `PR gate`. Il job non applica fix, migrazioni, hook Git o funzioni AI.

Ogni finding non soppresso, crash o output non interpretabile rende rosso il check. Un finding reale viene corretto; un falso positivo viene soppresso soltanto con eccezione minima, motivazione versionata e review nella stessa PR. Non sono ammessi `continue-on-error`, bypass temporanei, riduzioni globali delle soglie o baseline usate per nascondere finding. Metriche e punteggio senza finding restano informativi.

## Comando di pubblicazione

Il comando seguente classifica la diff ed esegue il preflight locale senza mutazioni remote:

```bash
npm run publication:github
```

Soltanto dopo una richiesta affermativa `Pubblica`, l'opzione `--execute` esegue l'intero ciclo tecnico applicabile: push, creazione o rilettura della PR, attesa dei gate richiesti, squash merge, eliminazione del branch e rilettura di `main`, PR, albero Git e working tree:

```bash
npm run publication:github -- --execute
```

La riconciliazione della ruleset è idempotente, preserva le altre protezioni e viene riletta dopo l'applicazione. Per sole modifiche documentali, di test o di governance il comando termina qui. Per una modifica runtime avvia e attende la candidata di release exact-SHA; se rileva una Production già distribuita con successo e il workflow Production qualificato, avvia e attende anche deploy e readback. In assenza di una release attiva si ferma alla candidata perché la prima attivazione richiede un'autorizzazione separata.

## Candidata di release

Il workflow manuale `Release candidate` accetta soltanto il commit corrente di `main`, identifica l'unica pull request squash che lo ha prodotto e verifica che l'albero del commit coincida con quello dell'HEAD della PR. Esegue quindi la matrice pubblica completa, scansiona il lockfile con OSV-Scanner e costruisce una sola immagine ARM64. L'archivio e il manifest vengono caricati come artefatto temporaneo; job separati scaricano lo stesso artefatto, verificano commit, albero Git, image ID e SHA-256, ricaricano l'immagine senza ricostruirla e scansionano direttamente l'archivio ARM64. La scansione dell'immagine fallisce chiusa su errori o output non interpretabili e blocca qualunque vulnerabilità con un fix distribuibile. Le vulnerabilità senza fix, incluse quelle Critical, restano advisory accettate dal proprietario perché non esiste una correzione distribuibile da applicare; conteggi, severità e identificativi restano visibili fino all'aggiornamento della base o del pacchetto interessato. Scanner e azioni sono identificati da digest o SHA immutabili. La pull request verifica automaticamente le fonti ministeriali quando cambiano originali, catalogo o regole; i gate privati su corpus reale, software ufficiale, backup e VPS restano separati e obbligatori quando pertinenti.

## Production

Il workflow manuale `Production` accetta il commit completo di `main` e il run ID della relativa candidata. Prima di trasferire file verifica tramite API che quel run appartenga al workflow `Release candidate`, sia concluso con successo su `main` e abbia lo stesso SHA; scarica quindi l'artefatto exact-run, ne rilegge manifest, tree, digest, piattaforma e image ID senza ricostruirlo e registra un GitHub Deployment con task `sequent-production`.

Il deploy acquisisce il lock Docker condiviso, richiede il runtime precedente healthy e un database coerente senza job attivi, prova le migrazioni su una copia isolata e crea uno snapshot prima di sostituire il container Sequent. Durante lo switch un marker applicativo lascia disponibili le sole richieste non mutanti e risponde `503` alle altre. Il readback HTTPS avviene mentre il marker è ancora attivo e richiede un health pubblico esclusivamente generico; image ID e commit esatti vengono verificati separatamente sul runtime della VPS, insieme a utente non-root, filesystem in sola lettura, capability e controlli SQLite. Un errore ripristina automaticamente dati, configurazione e immagine precedenti. Solo dopo tutti i controlli il marker viene rimosso. Archivio, manifest, ricevuta e image ID restano nel registro release della VPS con retention limitata al runtime e al rollback più recenti.

La prima attivazione richiede l'autorizzazione esplicita del proprietario, la configurazione protetta dell'environment GitHub `Production` e la qualifica separata della route Caddy. Le esecuzioni successive non modificano Caddy, Dynu o firewall: distribuiscono esclusivamente l'artefatto già qualificato sull'istanza esistente.

## Aggiornamenti dipendenze

Dependabot apre settimanalmente pull request raggruppate per npm e GitHub Actions. Non esiste auto-merge indiscriminato: runtime, toolchain, Codex, SQLite, OCR, Oxfmt, Oxlint, DIZ e versioni major richiedono valutazione deliberata secondo il Master Plan.

## Chiusura di una pubblicazione

Prima del merge verificare required checks, conversazioni e confine pubblico. Dopo il merge rileggere `main`, identità dell'albero approvato, stato della pull request, branch remoti, ruleset e working tree. Per una modifica runtime rileggere anche candidata, artefatto e, se già applicabile, deployment, release e stato live. `Pubblica` autorizza questi passaggi tecnici sull'istanza già attiva, ma non la prima attivazione né modifiche a Caddy, Dynu o firewall.
