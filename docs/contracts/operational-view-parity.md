# Contratto di parità fra Vista Quadri e Vista operativa

## Scopo

La Vista Quadri e la Vista operativa sono due prospettive degli stessi campi canonici. La parità informativa non richiede la stessa composizione grafica, ma richiede che ogni dato professionale applicabile sia consultabile in entrambe e che ogni dato inseribile sia modificabile da entrambe senza copie o sincronizzazioni ambigue.

La matrice completa è [`operational-view-parity.json`](../../src/domain/official-catalog/operational-view-parity.json). Viene generata deterministicamente dal catalogo qualificato tramite:

```bash
npm run generate:operational-parity-map
```

La matrice contiene una riga per ciascuno dei 715 campi visibili e registra identificativo e percorso canonico, Quadro, oggetto professionale, cardinalità, applicabilità, modalità di gestione, stato corrente nella Vista operativa, destinazione e test di parità richiesti. Modalità e destinazione hanno ciascuna stato, motivazione, provenienza e blocker: il valore `null` della modalità significa che le fonti non consentono ancora di decidere fra inserimento, derivazione e gestione automatica.

## Criterio di qualificazione semantica

- `qualificata`: la classificazione discende da una regola esplicita, da una formula deterministica, da una sottoscrizione oppure dall’identità qualificata di un oggetto professionale;
- `candidata`: la classificazione è coerente con il modello, ma dipende ancora dal default editabile del catalogo o da una scelta di raggruppamento operativo;
- `irrisolta`: la fonte prova esistenza, tipo o applicabilità del campo, ma non permette di stabilire chi produce il valore; la riga contiene un blocker verificabile e la modalità resta `null`.

## Destinazioni operative

La revisione di prodotto conferma otto destinazioni di primo livello. Per i campi professionali la proprietà dell’area è quindi definitiva e `destinationReview.uiDecision = definitiva`; l’identificativo storico `candidateOperationalArea` resta il nome tecnico della proprietà della matrice. I soli dati tecnici o di servizio restano senza destinazione UI definitiva: sono diagnostici e non entrano nella navigazione ordinaria finché il contratto di produzione o trasmissione non ne chiarisce il proprietario.

La decisione sulla destinazione non promuove automaticamente la modalità di gestione: un campo con revisione semantica `candidata` è consultabile dalla medesima fonte canonica ma resta in sola lettura nella Vista operativa; un campo `irrisolto` mostra il blocker e non produce un controllo editabile.

Le regole applicate sono deliberatamente ristrette:

- i 5 campi con `derivedFrom` esplicito sono `derivato` e qualificati;
- i totali EE e gli importi EF sono automatici soltanto quando la fonte ufficiale prescrive un’uguaglianza o una formula deterministica;
- `ImpostaNonDovuta` è automatica perché l’XSD ne fissa il valore e la regola ne determina la presenza;
- le firme sono inserite e qualificate come sottoscrizioni, non calcolate;
- gli importi che la fonte dichiara valorizzabili dal professionista restano inseriti;
- una casella di presenza o scelta priva di regola sul produttore resta candidata;
- dati di servizio, caselle dei Quadri compilati e importi privi sia di formula sia di regola di valorizzazione restano irrisolti.

## Criterio di copertura

- `coperto`: il campo canonico è visibile esattamente nella propria area e, quando è un input qualificato, viene modificato dalla stessa azione di salvataggio della Vista Quadri; per un dato derivato è sufficiente la sola lettura dalla medesima funzione deterministica.
- `parziale`: il campo canonico è visibile esattamente, ma la Vista operativa lo mantiene in sola lettura perché la modalità è candidata o irrisolta, oppure perché la gestione automatica non è ancora coerente e non modificabile in entrambe le viste.
- `mancante`: il campo non è esposto perché non ha ancora una destinazione approvata nella navigazione operativa ordinaria.

Una sintesi, un calcolo o un’etichetta simile non costituiscono copertura del campo se non è dimostrata la stessa origine canonica.

La copertura non è una fotografia compilata manualmente. `buildOperationalParityMap` usa la stessa regola `isOperationalParityEditable` consumata dal renderer operativo; l’azione server accetta dalla Vista operativa soltanto i campi che quella regola qualifica come modificabili. La matrice registra inoltre la motivazione e i riferimenti al codice che producono ogni stato.

## Gap analysis corrente

| Stato    | Campi | Risultato                                                                                                   |
| -------- | ----: | ----------------------------------------------------------------------------------------------------------- |
| Coperto  |   419 | 414 input qualificati modificabili e 5 valori derivati dalla stessa fonte                                   |
| Parziale |   291 | 223 modalità candidate, 29 blocker visibili e 39 campi automatici non ancora coerenti fra entrambe le viste |
| Mancante |     5 | Soli dati tecnici o di servizio senza destinazione approvata nella navigazione operativa ordinaria          |

La nuova superficie espone quindi esattamente 710 dei 715 campi visibili: 414 sono modificabili e 296 sono in sola lettura. La parità bidirezionale completa non è ancora dimostrata. In particolare:

- i 223 campi candidati sono consultabili ma non modificabili dalla Vista operativa finché la loro modalità non viene qualificata;
- 29 campi con blocker semantico hanno una destinazione definitiva e sono consultabili, ma non producono un controllo editabile;
- i 39 campi classificati come automatici sono in sola lettura nella Vista operativa, mentre la Vista Quadri non applica ancora a tutti lo stesso vincolo;
- i 5 dati tecnici o di servizio restano fuori dalla navigazione operativa ordinaria finché non viene deciso se debbano essere nascosti, diagnostici o consultabili;
- i campi di devoluzione dei Quadri e lo scenario operativo di devoluzione sono oggi modelli distinti senza una parità campo-per-campo dimostrata;
- l’esposizione statica e il salvataggio condiviso non sostituiscono ancora i test parametrizzati di persistenza, isolamento, cardinalità e applicabilità richiesti per ogni famiglia di campo.

La modalità risultante è:

| Modalità                 | Campi | Qualificazione                                               |
| ------------------------ | ----: | ------------------------------------------------------------ |
| Inserito                 |   637 | Include dati qualificati e proposte ancora candidate         |
| Derivato                 |     5 | Tutti qualificati da `derivedFrom`                           |
| Gestito automaticamente  |    39 | Totali/formule EE-EF e `ImpostaNonDovuta`, tutti qualificati |
| Non determinato (`null`) |    34 | Blocker esplicito: nessuna inferenza per analogia            |

Lo stato complessivo della revisione semantica è:

| Stato       | Campi |
| ----------- | ----: |
| Qualificata |   458 |
| Candidata   |   223 |
| Irrisolta   |    34 |

I 34 blocker sono circoscritti a 16 caselle dei Quadri compilati, 5 dati tecnici o di servizio, l’importo da versare del frontespizio e 12 importi EF privi di formula o regola esplicita di valorizzazione: imposta di successione calcolata, credito d’imposta ipotecaria e dieci importi elementari di sanzioni/interessi. I due totali di sanzioni e interessi restano invece automatici, perché la fonte ne prescrive la somma.

## Distribuzione nelle aree operative

La distribuzione riesaminata dei campi è:

| Area operativa      | Campi |
| ------------------- | ----: |
| Patrimonio          |   295 |
| Devoluzione         |   120 |
| Persone             |   116 |
| Imposte e pagamenti |   101 |
| Riepilogo finale    |    30 |
| Panoramica          |    29 |
| Controlli finali    |    13 |
| Documenti           |    11 |

Questi conteggi descrivono la destinazione completa del catalogo, non il numero di controlli mostrati per ogni singola pratica. La Vista operativa applica la cardinalità al contesto corrente: espone soltanto le schede dei soggetti, dei beni e delle passività esistenti, mentre la creazione resta affidata ai moduli professionali dell’area. Le liste di persone e patrimonio collegano direttamente la scheda canonica pertinente; i controlli finali collegano l’area in cui correggere il dato. Il numero mostrato nell’intestazione dei dati canonici è quindi il totale dei campi pertinenti agli oggetti presenti, non l’intero inventario teorico dell’area.

## Esito sull’ipotesi delle otto aree

L’inventario conferma che le otto aree proposte sono esaustive come primo livello: ogni campo trova una destinazione candidata e non emerge una nona area principale. L’inventario modifica però l’interpretazione di alcune aree:

- `Patrimonio` non può essere una lista piatta: deve contenere schede tipizzate per immobili ordinari e tavolari, aziende, rapporti finanziari, aeromobili, imbarcazioni, altri beni e passività;
- `Devoluzione` deve essere l’unica rappresentazione operativa di titolo successorio, beneficiari, quote, diritti e agevolazioni per bene, eliminando l’attuale separazione fra campi dei Quadri e scenario operativo;
- `Imposte e pagamenti` deve comprendere liquidazione, addebito, crediti, esenzioni e riduzioni, non soltanto il risultato sintetico del calcolo;
- `Panoramica` scende da 80 a 29 campi: conserva dati generali e indicatori trasversali, mentre presentatore, dichiarante, defunto, eredi e separazione EH passano a `Persone`; testamento e reintegro a `Devoluzione`; aziende, navi e aeromobili a `Patrimonio`;
- `Documenti` resta necessaria anche se soltanto 11 campi del modello appartengono al Quadro EG: originali, fonti e allegati operativi esistono anche fuori dai 715 campi visibili;
- `Riepilogo finale` passa da 27 a 30 campi: accoglie documenti prodotti e sottoscrizioni contestuali, comprese EH ed EI, ma non i 5 dati tecnici o di servizio, candidati nei `Controlli finali` con destinazione ancora irrisolta;
- le 16 caselle dei Quadri compilati restano candidate nel riepilogo, ma senza modalità fino a una regola ufficiale che dimostri se sono inserite o derivate.

`Dati da verificare` è confermato come superficie condizionale trasversale e non come area proprietaria dei dati. `Cronologia` non riceve alcun campo del modello e resta correttamente secondaria.

## Identità e isolamento del Quadro EH

I 207 campi EH non costituiscono un archivio globale delle dichiarazioni successive e non puntano in modo vivo alla dichiarazione sorgente. Appartengono sempre allo snapshot JSON revisionato della dichiarazione selezionata:

- 128 hanno identità `declarationId + fieldId`;
- 79 sono ripetibili e aggiungono `occurrenceId`, con il relativo gruppo di occorrenza;
- quando si crea una dichiarazione successiva, `createSuccessiveDeclaration` copia i valori nello snapshot nuovo;
- dopo la copia, sorgente e successiva hanno `declarationId` e revisione autonomi; ogni modifica resta isolata e un conflitto di revisione non sovrascrive silenziosamente l’altra dichiarazione.

La dicitura tecnica `DichSost` descrive il contenuto del Quadro EH, non l’appartenenza del campo a una dichiarazione diversa da quella selezionata. La matrice registra questa identità come qualificata per tutte le 207 righe e richiede comunque test di copia iniziale, indipendenza successiva e cardinalità delle 79 occorrenze.

## Matrice dei test necessari

Ogni riga della matrice dichiara i test richiesti. La parità potrà essere dichiarata soltanto quando risultano verdi almeno le seguenti famiglie:

1. **Inventario:** corrispondenza esatta fra i 715 campi visibili del catalogo e le 715 righe della matrice.
2. **Vista Quadri → Vista operativa:** salvataggio del campo canonico, nuova richiesta server e verifica del valore nel corretto oggetto e contesto operativo.
3. **Vista operativa → Vista Quadri:** modifica operativa, nuova richiesta server e verifica dello stesso campo canonico nel Quadro pertinente.
4. **Persistenza:** rilettura dopo reload e riapertura della pratica senza perdita o trasformazione non dichiarata.
5. **Isolamento:** separazione per dichiarazione, soggetto, bene e occorrenza ripetibile.
6. **Cardinalità:** creazione, riordino e rimozione controllata delle occorrenze, con conservazione dell’identità.
7. **Applicabilità:** presenza e assenza coerenti per tipo di dichiarazione, condizioni XSD, choice e regole ufficiali.
8. **Derivati e automatici:** stessa fonte in entrambe le viste, sola lettura e ricalcolo deterministico.
9. **Concorrenza:** conflitto di revisione senza sovrascrittura silenziosa da nessuna delle due viste.
10. **E2E rappresentativi:** almeno un caso per tipo di controllo, oggetto professionale, cardinalità e dichiarazione, oltre alla copertura parametrica di dominio.
11. **Qualificazione semantica:** una riga irrisolta deve bloccare la promozione della modalità; una modalità candidata resta consultabile ma non diventa automaticamente editabile.
12. **Dichiarazioni successive:** copia iniziale controllata, nessun riferimento vivo alla sorgente, revisione indipendente e isolamento di tutte le occorrenze EH.

Il test [`operational-parity.test.ts`](../../tests/unit/operational-parity.test.ts) dimostra oggi completezza e riproducibilità dell’inventario, esposizione delle destinazioni definitive e coerenza fra matrice e regola di modificabilità della UI. Non dimostra da solo il round-trip runtime di tutte le famiglie. Finché esistono righe `parziale` o `mancante`, un gate di parità completa deve restare rosso o non ancora attivato.
