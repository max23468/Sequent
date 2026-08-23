# Sequent — Fonti ufficiali

## Fonte unica dei metadati

Identità del bundle, nomi dei file, date ufficiali, ruoli, dimensioni, hash, precedenze e inventario XSD risiedono esclusivamente nel manifest macchina [`source-manifest.json`](../src/domain/official-catalog/source-manifest.json). Il documento non ne mantiene una copia narrativa.

Le date presenti nel manifest identificano gli artefatti ufficiali o l'efficacia di una regola: non rappresentano scadenze di progetto. Le fonti superate restano nel bundle per lineage e regressione, ma non governano l'implementazione corrente.

## Precedenza e divergenze

La precedenza completa delle fonti è definita nello stesso manifest. Gli overlay osservati, le anomalie documentali e i mapping irrisolti risiedono in [`delta-overlays.json`](../src/domain/official-catalog/delta-overlays.json). Un conflitto irrisolto blocca l'export interessato.

Il contratto applicativo è descritto in [`official-compliance.md`](contracts/official-compliance.md); il Master Plan stabilisce i criteri di prodotto senza duplicare metadati del bundle.

## Verifica

Gli originali e l'albero XSD risiedono fuori da Git. La verifica riproducibile legge i manifest privati e confronta conteggi, dimensioni, pagine, hash, digest compositi, sicurezza dell'archivio, well-formedness e compilazione offline dello schema principale:

```bash
npm run verify:sources
```

Qualunque aggiornamento delle fonti modifica prima il manifest macchina e gli artefatti derivati; la documentazione cambia soltanto se cambia una regola, una responsabilità o un criterio operativo.
