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
- `public-gates`.

La ruleset vieta eliminazione e non-fast-forward di `main`, consente soltanto squash merge, invalida le review obsolete e richiede approvazione aggiuntiva per modifiche non attribuite.

## CI advisory

Con lo scaffolding SvelteKit viene attivato `Svelte Doctor` come job non richiesto dalla ruleset. Il job esegue soltanto analisi in lettura, mostra i finding nel summary della PR e non applica fix, migrazioni, hook Git o funzioni AI.

Il carattere advisory riguarda il meccanismo CI, non la gravità del difetto: sicurezza, correttezza, perdita dati e regressioni rilevanti confermate vengono triagiate e possono bloccare la PR. Gli altri finding restano consigli; i falsi positivi vengono soppressi puntualmente con una motivazione versionata. Il punteggio dello strumento non è una soglia di merge finché Svelte Doctor non viene qualificato sul codice reale di Sequent.

## Review Codex exact-HEAD

Il workflow `Codex review gate` esegue il primo giro su apertura o passaggio a ready. Dopo ogni `synchronize`, un owner, member o collaborator deve aggiungere un commento top-level il cui corpo sia esattamente:

```text
@codex review
```

Il gate accetta soltanto segnali riferiti all'HEAD corrente. P0/P1 producono fallimento; P2/P3 restano advisory soltanto dopo il completamento della review e trenta secondi di assestamento. Una nuova commit invalida il risultato precedente. Errori operativi del bot producono stato `error` e richiedono una nuova invocazione esatta quando il servizio è disponibile.

## Aggiornamenti dipendenze

Dependabot apre settimanalmente pull request raggruppate per npm e GitHub Actions. Non esiste auto-merge indiscriminato: runtime, toolchain, Codex, SQLite, OCR, Oxfmt, Oxlint, DIZ e versioni major richiedono valutazione deliberata secondo il Master Plan.

## Chiusura di una pubblicazione

Prima del merge verificare required checks, review exact-HEAD, conversazioni e confine pubblico. Dopo il merge rileggere `main`, stato della pull request, branch remoti e working tree. La pubblicazione GitHub non autorizza deploy, release o attivazioni sulla VPS.
