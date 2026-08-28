# Sequent — Fonti ufficiali

## Fonte unica dei metadati

Identità del bundle, nomi dei file, date ufficiali, ruoli, dimensioni, hash, precedenze e inventario XSD risiedono esclusivamente nel manifest macchina [`source-manifest.json`](../src/domain/official-catalog/source-manifest.json). Il documento non ne mantiene una copia narrativa.

Le date presenti nel manifest identificano gli artefatti ufficiali o l'efficacia di una regola: non rappresentano scadenze di progetto. Le fonti superate restano nel bundle per lineage e regressione, ma non governano l'implementazione corrente.

Ogni voce dichiara almeno identificativo stabile, alias locale, titolo, ruolo, stato, dimensione e hash. Dove pertinente aggiunge autorità, categoria, URL ufficiale, data di pubblicazione, periodo di efficacia, disposizioni rilevanti e stato della riconciliazione. Le categorie separano:

- modello, istruzioni e tecnica;
- norme e decisioni vincolanti;
- chiarimenti e pagamenti;
- valori annuali;
- materiale operativo;
- programmi, moduli di controllo e manuali ufficiali.

Questa separazione evita di trattare una circolare, una guida o uno snapshot di un archivio come se avessero lo stesso valore di una legge o di un XSD.

## Servizi vivi e software ufficiale

Il repository conserva l’originale pubblico quando esiste un documento o un programma stabile. Per i servizi che cambiano nel tempo conserva invece la pagina ufficiale di accesso e richiede una lettura dal vivo prima dell’uso operativo. È il caso degli archivi territoriali e delle ricevute.

Il bundle comprende anche la pagina ufficiale di download, il programma di installazione per macOS, l’utilità di correzione, i manuali e il deposito completo del modulo SUC13 corrente. Il programma più grande usa Git LFS, ma resta parte della repository e viene trasferito con il normale clone completo. In questo modo installazione e verifiche sono ripetibili senza scaricare ogni volta gli stessi originali.

La copia locale non prova però che quella versione sia ancora corrente: prima di una qualificazione ufficiale si confrontano sempre pagina, deposito e avviso vivi dell’Agenzia. Non entrano nel bundle l’applicazione installata, le preferenze dell’utente, le credenziali, le pratiche o altri dati personali.

## Precedenza e divergenze

La precedenza completa delle fonti è definita nello stesso manifest. Gli overlay osservati, le anomalie documentali e i mapping irrisolti risiedono in [`delta-overlays.json`](../src/domain/official-catalog/delta-overlays.json). Un conflitto irrisolto blocca l'export interessato.

`delta-overlays.json` registra anche la riconciliazione dei gruppi di fonti aggiunti per l’ambito corrente e conserva la motivazione di ogni esito. Un originale acquisito e verificato non diventa automaticamente una regola applicata: l’esito è conclusivo soltanto quando periodo, responsabilità e test sono espliciti.

Il contratto applicativo è descritto in [`official-compliance.md`](contracts/official-compliance.md); il Master Plan stabilisce i criteri di prodotto senza duplicare metadati del bundle.

## Verifica

Gli originali ministeriali pubblici e l'albero XSD risiedono in `private/official-sources/` e sono versionati nel repository. La verifica riproducibile legge i manifest, rifiuta file non dichiarati e confronta conteggi, dimensioni, pagine, hash, eventuali impronte pubblicate dall’autorità, digest compositi, integrità degli archivi, well-formedness e compilazione offline dello schema principale:

```bash
npm run verify:sources
```

Quando si aggiunge o si sostituisce un originale, i metadati tecnici si aggiornano con:

```bash
node scripts/official-sources/refresh-manifest.mjs
```

Il comando ricalcola dimensioni, pagine, hash, digest composito e le copie del manifest conservate accanto agli originali. `verify:sources` resta il controllo indipendente successivo e intercetta anche snapshot HTML non validi o pagine di errore.

Qualunque aggiornamento modifica prima manifest, originali e stato della riconciliazione; il catalogo derivato e la documentazione cambiano quando cambia una regola, una responsabilità, un periodo o un criterio operativo.
