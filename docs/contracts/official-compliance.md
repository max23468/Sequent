# Contratto di conformità ufficiale

## Baseline

- bundle: `SUC-OFFICIAL-2025-07-15-FULL`;
- digest fonti: `f5c4dba027c36609216bd956bfb5dc29eef4978aaa2dc802d85b6e70277b1603`;
- digest albero XSD: `aa6ec0d226d213447d27a79a5407d2f6a178cfe4962a64954aeeb1b6e238bb83`;
- main schema: `SUC/xsd/fornituraSUC13_v1.xsd`;
- posizione privata: `/opt/sequent/private/official-sources/`.

Il gate `npm run verify:sources` verifica dieci artefatti, dimensioni, pagine, SHA-256, digest compositi, sicurezza e contenuto dello ZIP, well-formedness dei 13 XSD e compilazione del main schema con `lxml.etree.XMLSchema` e accesso di rete disabilitato.

## Gerarchia

`SRC-09` prevale su `SRC-08` e `SRC-07` soltanto per gli elementi espressamente modificati. `SRC-08` governa la struttura macchina; `SRC-07` documenta diagrammi, annotazioni e controlli. Un conflitto irrisolto blocca l'export interessato.

## Prima riconciliazione SRC-07/SRC-08/SRC-09

L'ispezione M0 registra tre risultati:

1. le modifiche `a–m` e `o–p` di `SRC-09` sono materialmente presenti nelle annotazioni del main XSD di `SRC-08` per `Agevolazioni`, `Riduzioni`, Sezione V-bis, `ValorePrecSucc` e i campi del soggetto EA; devono ancora diventare regole deterministiche e test;
2. `SRC-09`, pagina 3, contiene una voce `n)` vuota: è un'anomalia documentale e non autorizza alcuna regola dedotta;
3. la voce `q)` dichiara una modifica della tipologia di `Provincia` senza identificare nel delta l'esatto percorso XSD né il tipo precedente/nuovo. Poiché `Provincia` compare in più contesti, il mapping resta `unresolved` e blocca qualsiasi regola dipendente finché il confronto con `SRC-07` e la lineage non produce percorso e tipo esatti.

Non è stata rilevata un'incompatibilità di compilazione fra gli XSD del bundle. Questo non equivale alla chiusura di `TG-COMPLIANCE`.

## Criterio di arresto

Il catalogo non può diventare `releaseEligible` se esistono campi senza provenienza, overlay non classificati, regole fiscali dedotte, XSD non compilabile o divergenze capaci di alterare DIZ, calcoli, allegati o telematico.
