# Contratto di conformità ufficiale

## Baseline

La fonte unica per identità del bundle, artefatti, date ufficiali, dimensioni, digest e albero XSD è [`source-manifest.json`](../../src/domain/official-catalog/source-manifest.json). Gli originali risiedono nella directory privata configurata per l'istanza e non entrano in Git.

`npm run verify:sources` confronta gli originali con i manifest privati, verifica PDF e archivio XSD e compila offline lo schema principale. Il contratto non replica valori che il verificatore può leggere deterministicamente.

## Gerarchia

La precedenza completa è dichiarata nel manifest macchina. In particolare, gli overlay prevalgono soltanto sugli elementi espressamente modificati, la fonte XSD governa la struttura macchina e la documentazione tecnica ufficiale ne governa annotazioni e controlli. Un conflitto irrisolto blocca l'export interessato.

## Divergenze

Gli esiti della riconciliazione, inclusi elementi osservati, anomalie documentali e mapping irrisolti, risiedono in [`delta-overlays.json`](../../src/domain/official-catalog/delta-overlays.json). Test, catalogo e report leggono quella struttura invece di mantenere un secondo elenco in questo contratto.

## Criterio di arresto

Il catalogo non può diventare `releaseEligible` se esistono campi senza provenienza, overlay non classificati, regole fiscali dedotte, XSD non compilabile o divergenze capaci di alterare DIZ, calcoli, allegati o telematico.
