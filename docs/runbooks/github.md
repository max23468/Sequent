# Runbook GitHub

## Profilo del repository

`max23468/Sequent` è un repository pubblico proprietario, senza licenza. `main` è il branch permanente e si integra esclusivamente tramite pull request e squash merge; i branch temporanei vengono eliminati dopo il merge.

Issues, Projects e Wiki restano disabilitati. GitHub Actions usa permessi predefiniti di sola lettura, non può approvare pull request, ammette soltanto azioni GitHub-owned e richiede riferimenti immutabili per SHA. Secret scanning, push protection, Dependabot security updates, vulnerability alerts e private vulnerability reporting devono restare attivi.

## Required checks

La ruleset `main protection`, senza bypass, richiede HEAD aggiornato, conversazioni risolte e questi controlli:

- `Foundation`;
- `Dependency review`;
- `Analyze (javascript-typescript)`;
- `codex-review`;
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

## Review Codex exact-HEAD

Il workflow `Codex review gate` esegue il primo giro su apertura o passaggio a ready. Dopo ogni `synchronize`, un owner, member o collaborator deve aggiungere un commento top-level il cui corpo sia esattamente:

```text
@codex review
```

Il gate accetta soltanto segnali riferiti all'HEAD corrente. Un nuovo commit imposta subito lo stato pending e termina il job di reset; il commento autorizzato avvia un solo polling. Il polling usa intervalli brevi nella finestra ordinaria e poi rallenta.

P0/P1 producono fallimento. P2/P3 vengono copiati in un commento stabile associato all'HEAD e restano advisory. Dopo la registrazione il workflow risolve soltanto i thread automatici P2/P3 senza risposte umane. Se il token GitHub Actions non può eseguire la mutazione GraphQL, il comando di pubblicazione completa la stessa operazione con l'identità locale autorizzata prima del merge. Non vengono risolti thread P0/P1, conversazioni miste o thread ai quali una persona ha risposto. La ruleset continua quindi a richiedere la risoluzione di tutte le conversazioni reali. Errori operativi del bot, della registrazione o del fallback locale producono stato `error`.

## Comando di pubblicazione

Il comando seguente classifica la diff ed esegue il preflight locale senza mutazioni remote:

```bash
npm run publication:github
```

Soltanto dopo una richiesta affermativa `Pubblica`, l'opzione `--execute` esegue l'intero ciclo tecnico applicabile: push, creazione o rilettura della PR, attesa dei gate preliminari, singola invocazione Codex, attesa exact-HEAD, squash merge, eliminazione del branch e rilettura di `main`, PR, albero Git e working tree:

```bash
npm run publication:github -- --execute
```

La riconciliazione della ruleset è idempotente, preserva le altre protezioni e viene riletta dopo l'applicazione. Per sole modifiche documentali, di test o di governance il comando termina qui. Per una modifica runtime avvia e attende la candidata di release exact-SHA; se rileva una Production già distribuita con successo e il workflow Production qualificato, avvia e attende anche deploy e readback. In assenza di una release attiva si ferma alla candidata perché la prima attivazione richiede un'autorizzazione separata.

## Candidata di release

Il workflow manuale `Release candidate` accetta soltanto il commit corrente di `main`, identifica l'unica pull request squash che lo ha prodotto e verifica che l'albero del commit coincida con quello dell'HEAD coperto da review Codex e gate `codex-review` verde. Esegue quindi la matrice pubblica completa, scansiona il lockfile con OSV-Scanner e costruisce una sola immagine ARM64. L'archivio e il manifest vengono caricati come artefatto temporaneo; job separati scaricano lo stesso artefatto, verificano commit, albero Git, image ID e SHA-256, ricaricano l'immagine senza ricostruirla e scansionano direttamente l'archivio ARM64. La scansione dell'immagine fallisce chiusa su errori o output non interpretabili e blocca vulnerabilità critiche o con un fix disponibile; le vulnerabilità non critiche prive di fix restano visibili come advisory, perché non esiste una correzione distribuibile da applicare. Scanner e azioni sono identificati da digest o SHA immutabili. I gate privati su fonti ufficiali, corpus reale, software ufficiale, backup e VPS restano separati e obbligatori quando pertinenti.

## Aggiornamenti dipendenze

Dependabot apre settimanalmente pull request raggruppate per npm e GitHub Actions. Non esiste auto-merge indiscriminato: runtime, toolchain, Codex, SQLite, OCR, Oxfmt, Oxlint, DIZ e versioni major richiedono valutazione deliberata secondo il Master Plan.

## Chiusura di una pubblicazione

Prima del merge verificare required checks, review exact-HEAD, conversazioni e confine pubblico. Dopo il merge rileggere `main`, identità dell'albero approvato, stato della pull request, branch remoti, ruleset e working tree. Per una modifica runtime rileggere anche candidata, artefatto e, se già applicabile, deployment, release e stato live. `Pubblica` autorizza questi passaggi tecnici sull'istanza già attiva, ma non la prima attivazione né modifiche a Caddy, Dynu o firewall.
