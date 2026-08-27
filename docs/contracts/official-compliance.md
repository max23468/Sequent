# Contratto di conformità ufficiale

## Baseline

La fonte unica per identità del bundle, artefatti, date ufficiali, dimensioni, digest e albero XSD è [`source-manifest.json`](../../src/domain/official-catalog/source-manifest.json). Gli originali ministeriali pubblici risiedono in `private/official-sources/` e sono versionati nel repository.

`npm run verify:sources` confronta gli originali con i manifest, verifica PDF, programmi e archivi, controlla le impronte ufficiali dichiarate e compila offline lo schema principale. Il contratto non replica valori che il verificatore può leggere deterministicamente.

Il catalogo corrente è collegato al pacchetto identificato da [`source-manifest.json`](../../src/domain/official-catalog/source-manifest.json), ma non è ancora qualificato per la chiusura. Copertura, numero di campi, regole, passaggi di calcolo e divergenze irrisolte sono letti dalle strutture macchina collegate, senza duplicarne qui i valori. La struttura dei campi è disponibile nei Quadri; denominazioni, condizioni e controlli restano bloccanti dove la corrispondenza con le fonti visibili e semantiche non è stata dimostrata.

## Gerarchia

La precedenza completa è dichiarata nel manifest macchina. Le norme governano le regole giuridiche nel rispettivo periodo; provvedimenti, circolari, risoluzioni e guide svolgono il ruolo più limitato dichiarato nel catalogo. Gli overlay prevalgono soltanto sugli elementi espressamente modificati, la fonte XSD governa la struttura macchina e la documentazione tecnica ufficiale ne governa annotazioni e controlli. Un conflitto irrisolto blocca l'export interessato.

## Divergenze

Gli esiti della riconciliazione, inclusi elementi osservati, anomalie documentali e mapping irrisolti, risiedono in [`delta-overlays.json`](../../src/domain/official-catalog/delta-overlays.json). Test, catalogo e report leggono quella struttura invece di mantenere un secondo elenco in questo contratto.

Quando un’istruzione ufficiale richiede un giudizio professionale e non consente un controllo automatico univoco, il catalogo registra una conferma professionale obbligatoria. Questa classificazione preserva la provenienza senza inventare una regola fiscale.

## Qualificazione corrente

`TG-COMPLIANCE` è aperto. Sono dimostrati l’inventario strutturale XSD, la provenienza tecnica dei campi, il caso ministeriale già acquisito della catena `QE → ISN`, la conservazione degli originali e le regressioni interne presenti.

Il bundle ampliato acquisisce anche approvazione e chiarimenti della riforma, codici di pagamento, norme e correttivi successivi, valori annuali, la sentenza costituzionale pertinente, materiale operativo e copie integre dei programmi ufficiali necessari al collaudo. Queste fonti sono catalogate e verificabili, ma non ancora interamente tradotte in regole con periodo e test. Restano quindi da qualificare:

- la linea temporale delle norme applicabile alla singola pratica;
- pagamenti, interessi, coefficienti, rendite, usufrutto e casi storici;
- la versione corrente di SUC13 dichiarata nel manifest, il relativo modulo conservato nel bundle e gli archivi territoriali letti dal vivo;
- ricevute, allegati e casi residui del Modello 4;
- le prescrizioni ministeriali già classificate ma non applicate, l’intera autoliquidazione, la checklist completa e la preparazione degli allegati.

I blocchi correnti risiedono negli artefatti macchina del catalogo e impediscono di chiudere il risultato di dominio, interfaccia e output.

## Criterio di arresto

Il catalogo non può diventare `releaseEligible` se esistono campi senza provenienza, overlay non classificati, regole fiscali dedotte, XSD non compilabile o divergenze capaci di alterare DIZ, calcoli, allegati o telematico.

Una nuova fonte ministeriale, un campo privo di provenienza o una divergenza nei risultati riapre il gate e blocca gli output interessati fino a nuova qualificazione.
