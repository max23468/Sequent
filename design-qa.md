# Design QA — Brand Foundation Sequent

## Esito

**Final result: passed.**

Non restano differenze P0, P1 o P2 rispetto alle tavole approvate.

## Confronti eseguiti

| Superficie | Riferimento | Implementazione | Esito |
|---|---|---|---|
| Simbolo | tavola di marca, ritaglio nativo `72×82` | `static/brand/sequent-symbol-source.svg` | Sagome, rientri, intervalli e diagonali coincidenti; resta soltanto l’anti-aliasing del PNG sorgente |
| Dashboard chiara | `docs/brand/references/dashboard-desktop.png` | cattura browser locale, viewport `1487×1058` | Passata |
| Dashboard scura | `docs/brand/references/dashboard-dark.png` | cattura browser locale, viewport `1487×1058` | Passata |
| Dashboard mobile | `docs/brand/references/dashboard-mobile.png` | cattura browser locale, viewport `402×874` | Passata per shell, gerarchia, azioni e navigazione |
| Workspace | `docs/brand/references/workspace-desktop.png` | cattura browser locale, viewport `1487×1058` | Passata per struttura a tre pannelli e gerarchia della fondazione |

## Verifiche funzionali e responsive

- Logo leggibile a `72×82` e `18×21`, senza collassi o contatti tra moduli.
- Dashboard operativa con stati vuoti onesti; nessuna fixture appare fuori dal design lab.
- Su mobile sono visibili `Nuova`, `Carica documenti` e, quando disponibile, `Riprendi ultima pratica`; i launcher desktop sono nascosti.
- Navigazione fissa mobile, ricerca, tema chiaro/scuro, workspace e launcher non qualificati verificati nel browser.
- Nessun overflow orizzontale alla viewport `402×874`.

## Divergenze intenzionali P3

- Il design lab mostra un piccolo badge fisso che dichiara la natura sintetica dei dati; non compare nell’app operativa.
- Gli stati vuoti mobili sono più bassi delle card piene della tavola, perché non vengono inserite righe ornamentali.
- Il workspace implementato conserva la composizione a tre pannelli ma non replica campi fiscali, controlli o anteprime future presenti nella tavola.
