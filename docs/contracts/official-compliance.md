# Contratto di conformità ufficiale

## Baseline

La fonte unica per identità del bundle, artefatti, date ufficiali, dimensioni, digest e albero XSD è [`source-manifest.json`](../../src/domain/official-catalog/source-manifest.json). Gli originali ministeriali pubblici risiedono in `private/official-sources/` e sono versionati nel repository.

`npm run verify:sources` confronta gli originali con i manifest, verifica PDF, programmi e archivi, controlla le impronte ufficiali dichiarate e compila offline lo schema principale. Il contratto non replica valori che il verificatore può leggere deterministicamente.

Il catalogo corrente è collegato al pacchetto identificato da [`source-manifest.json`](../../src/domain/official-catalog/source-manifest.json) ed è qualificato per l’ambito definito nel Master Plan. Copertura, numero di campi, regole, passaggi di calcolo e divergenze sono letti dalle strutture macchina collegate, senza duplicarne qui i valori. Ogni campo visibile ha una descrizione proveniente dal modello o dal controllo ufficiale; i soli contenuti binari degli allegati restano dati tecnici interni.

## Gerarchia

La precedenza completa è dichiarata nel manifest macchina. Le norme governano le regole giuridiche nel rispettivo periodo; provvedimenti, circolari, risoluzioni e guide svolgono il ruolo più limitato dichiarato nel catalogo. Gli overlay prevalgono soltanto sugli elementi espressamente modificati, la fonte XSD governa la struttura macchina e la documentazione tecnica ufficiale ne governa annotazioni e controlli. Un conflitto irrisolto blocca l'export interessato.

## Divergenze

Gli esiti della riconciliazione, inclusi elementi osservati, anomalie documentali e mapping irrisolti, risiedono in [`delta-overlays.json`](../../src/domain/official-catalog/delta-overlays.json). Test, catalogo e report leggono quella struttura invece di mantenere un secondo elenco in questo contratto.

Quando un’istruzione ufficiale richiede un giudizio professionale e non consente un controllo automatico univoco, il catalogo registra una conferma professionale obbligatoria. Questa classificazione preserva la provenienza senza inventare una regola fiscale.

## Qualificazione corrente

Il gate di conformità previsto dal Master Plan è chiuso per l’ambito corrente. Sono dimostrati:

- inventario e compilazione locale degli XSD ufficiali;
- corrispondenza completa degli elementi della dichiarazione, incluse le proprietà tecniche degli allegati;
- regole e passaggi di calcolo, quadrature dei Quadri EE ed EF ed esempi ufficiali acquisiti;
- distinzione normativa fra i periodi registrati nella cronologia legale, con blocco dei periodi annuali non qualificati;
- interessi, coefficienti annuali e caso storico della sentenza costituzionale catalogata;
- preparazione reale degli allegati in PDF/A-1b o TIFF Group 4, limiti per file e per pratica e conservazione dell’originale;
- checklist condizionale per allegati, dichiarazioni sostitutive, trust, prima casa e casi del Modello 4;
- controllo ufficiale eseguito in modo riproducibile su una pratica sintetica senza rilievi bloccanti.

La prova del controllo ufficiale usa una successione sintetica anteriore all’autoliquidazione. I campi di autoliquidazione sono qualificati separatamente mediante XSD corrente, regole temporali e casi di calcolo. I servizi territoriali e le ricevute restano soggetti a una nuova lettura dal canale vivo prima del futuro invio: è un controllo operativo successivo, non un vuoto dell’ambito corrente.

Il report della singola dichiarazione è disponibile in forma leggibile nel riepilogo e nel PDF, e in forma macchina nel riepilogo JSON. Riporta fonti e versioni applicate, Quadri presenti, esito del controllo ministeriale, allegati preparati, dimensioni, formati, eccezioni motivate, avvisi e blocchi.

## Riproduzione della qualificazione

```bash
npm run verify:sources
npm run verify:suc13-control
npm run test
```

Gli esiti conclusivi sono registrati in [`official-catalog.json`](../../src/domain/official-catalog/official-catalog.json), [`legal-timeline.json`](../../src/domain/official-catalog/legal-timeline.json) e [`suc13-control-qualification.json`](../../src/domain/official-catalog/suc13-control-qualification.json). La suite completa e i gate di pubblicazione verificano che il catalogo non torni in stato bloccato.

## Criterio di arresto

Il catalogo non può diventare `releaseEligible` se esistono campi senza provenienza, overlay non classificati, regole fiscali dedotte, XSD non compilabile o divergenze capaci di alterare DIZ, calcoli, allegati o telematico.

Una nuova fonte ministeriale, un campo privo di provenienza o una divergenza nei risultati riapre il gate e blocca gli output interessati fino a nuova qualificazione.
