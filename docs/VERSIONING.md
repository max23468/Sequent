# Sequent — Versioning

Questo documento applica la policy SemVer definita nel capitolo dedicato a versioning, release e aggiornamenti del Master Plan alle fasi canoniche del piano. Il Master Plan resta canonico per scope, prerequisiti, gate e criteri di uscita; questo documento è la fonte operativa unica per l'assegnazione dei numeri di versione fino alla `1.0.0`.

Le denominazioni delle fasi sono riportate senza duplicarne gli identificatori numerici, che restano definiti esclusivamente nel capitolo canonico del Master Plan.

## Principio

Le release di Sequent usano esclusivamente identificatori numerici `MAJOR.MINOR.PATCH`.

Non si usano suffissi o metadati di versione come `-alpha`, `-beta`, `-rc`, `-dev` o `+build`. I tag Git usano il solo prefisso `v`, per esempio `v0.2.0`.

Prima della `1.0.0`:

- `MINOR` identifica l'avanzamento alla successiva linea funzionale prevista da questa mappa;
- `PATCH` identifica correzioni, hardening, sicurezza e piccoli miglioramenti compatibili all'interno della stessa linea;
- modifiche incompatibili deliberate non vengono introdotte da una patch: richiedono almeno la successiva minor e, quando coinvolgono dati o formati, migrazione e rollback qualificati;
- il numero non rappresenta una percentuale di completamento e non deriva da numero di PR, commit o data.

## Mappa fino alla 1.0

| Versione | Fase / stato | Condizione |
| --- | --- | --- |
| `0.1.0` | baseline già consolidata | Bootstrap VPS, repository, source bundle e DIZ Lab; Interoperabilità DIZ; Fondazioni applicative e istanza unica già assorbite nella prima release numerata |
| `0.2.0` | Documenti, OCR e Codex | criteri di uscita della fase soddisfatti |
| `0.3.0` | Dominio, UX e output | criteri di uscita della fase soddisfatti |
| `0.4.0` | Offline selettivo | criteri di uscita della fase soddisfatti |
| `0.5.0` | Flusso ufficiale e operations | criteri di uscita della fase soddisfatti |
| `0.6.0` | Qualificazione Codex e acquisizione del corpus DIZ | fase Flusso ufficiale e operations chiusa, `TG-CODEX` qualificato realmente e cinque DIZ acquisiti nell'archivio applicativo |
| `0.7.0` | ingresso nella validazione finale | qualificazione Codex e acquisizione del corpus DIZ chiuse, con avvio della validazione finale su una baseline numerata |
| `0.7.x` | Validazione e go-live in corso | sole correzioni e hardening emersi durante la validazione finale |
| `1.0.0` | Validazione e go-live chiusa | `TG-GOLIVE` chiuso e approvazione finale dell'owner |

Il passaggio da `0.7.x` a `1.0.0` è intenzionale: non sono previste linee `0.8` o `0.9` solo per riempire la numerazione.

## Regole durante lo sviluppo

La versione dichiarata in `package.json` identifica l'ultima release numerata pubblicata, non ogni stato intermedio della working tree.

Durante il lavoro su una fase:

1. le modifiche confluiscono sotto `Unreleased` nel changelog;
2. PR e commit identificano gli stati intermedi senza incrementare automaticamente la versione;
3. una release minor viene preparata solo quando la condizione prevista dalla mappa è soddisfatta;
4. una patch viene emessa solo quando serve pubblicare una correzione o un miglioramento compatibile della linea corrente;
5. modifiche esclusivamente documentali, di test o di governance non richiedono da sole un incremento di versione né una release runtime.

Esempio durante Documenti, OCR e Codex: la release attiva può restare `0.1.0`; eventuali fix pubblicati possono produrre `0.1.1`, `0.1.2`, ecc.; la chiusura della fase produce `0.2.0`.

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
