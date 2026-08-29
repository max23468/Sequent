# Sequent — Versioning

Questo documento applica la policy SemVer definita nel capitolo 52 del Master Plan alla sequenza di milestone M0–M7. Il Master Plan resta canonico per scope, prerequisiti, gate e criteri di uscita delle milestone; questo documento è la fonte operativa per l'assegnazione dei numeri di versione fino alla `1.0.0`.

## Principio

Le release di Sequent usano esclusivamente identificatori numerici `MAJOR.MINOR.PATCH`.

Non si usano suffissi o metadati di versione come `-alpha`, `-beta`, `-rc`, `-dev` o `+build`. I tag Git usano il solo prefisso `v`, per esempio `v0.2.0`.

Prima della `1.0.0`:

- `MINOR` identifica l'avanzamento alla successiva linea funzionale prevista da questa mappa;
- `PATCH` identifica correzioni, hardening, sicurezza e piccoli miglioramenti compatibili all'interno della stessa linea;
- modifiche incompatibili deliberate non vengono introdotte da una patch: richiedono almeno la successiva minor e, quando coinvolgono dati o formati, migrazione e rollback qualificati;
- il numero non rappresenta una percentuale di completamento e non deriva da numero di PR, commit o data.

## Mappa fino alla 1.0

| Versione | Milestone / stato | Condizione |
| --- | --- | --- |
| `0.1.0` | baseline M0–M2 | fondazioni infrastrutturali e applicative già consolidate nella prima release numerata |
| `0.2.0` | M3 — Documenti, OCR e Codex | criteri di uscita M3 soddisfatti |
| `0.3.0` | M4 — Dominio, UX e output | criteri di uscita M4 soddisfatti |
| `0.4.0` | M5 — Offline selettivo | criteri di uscita M5 soddisfatti |
| `0.5.0` | M6 — Flusso ufficiale e operations | criteri di uscita M6 soddisfatti |
| `0.6.0` | linea di validazione M7 | M6 chiusa e avvio della validazione finale M7 su una baseline numerata |
| `0.6.x` | M7 — Validazione e go-live | sole correzioni e hardening emersi durante la validazione finale |
| `1.0.0` | M7 chiusa / go-live | `TG-GOLIVE` chiuso e approvazione finale dell'owner |

Il passaggio da `0.6.x` a `1.0.0` è intenzionale: non sono previste linee `0.7`, `0.8` o `0.9` solo per riempire la numerazione.

## Regole durante lo sviluppo

La versione dichiarata in `package.json` identifica l'ultima release numerata pubblicata, non ogni stato intermedio della working tree.

Durante il lavoro su una milestone:

1. le modifiche confluiscono sotto `Unreleased` nel changelog;
2. PR e commit identificano gli stati intermedi senza incrementare automaticamente la versione;
3. una release minor viene preparata solo quando la condizione prevista dalla mappa è soddisfatta;
4. una patch viene emessa solo quando serve pubblicare una correzione o un miglioramento compatibile della linea corrente;
5. modifiche esclusivamente documentali, di test o di governance non richiedono da sole un incremento di versione né una release runtime.

Esempio durante M3: la release attiva può restare `0.1.0`; eventuali fix pubblicati possono produrre `0.1.1`, `0.1.2`, ecc.; la chiusura di M3 produce `0.2.0`.

## Identità di release

Per ogni release numerata devono essere coerenti e riferirsi allo stesso contenuto qualificato:

- `package.json`: `X.Y.Z`;
- tag Git: `vX.Y.Z`;
- changelog: `## X.Y.Z`;
- GitHub Release: `Sequent X.Y.Z`;
- artefatto e runtime Docker: versione `X.Y.Z`, commit/albero Git e digest immutabile secondo la pipeline di pubblicazione.

Una divergenza tra questi identificatori blocca la pubblicazione della release interessata.

## Dopo la 1.0

Dalla `1.0.0` si applica SemVer ordinario:

- `PATCH` per correzioni compatibili;
- `MINOR` per nuove funzioni compatibili;
- `MAJOR` per cambiamenti incompatibili deliberati.

Resta valida la scelta di usare soltanto numeri `MAJOR.MINOR.PATCH`, senza suffissi prerelease o build metadata anche dopo la `1.0.0`.
