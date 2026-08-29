# Contratto di parità fra Vista Quadri e Vista operativa

## Scopo

La Vista Quadri e la Vista operativa sono due prospettive degli stessi campi canonici. La parità non richiede la stessa composizione grafica: richiede identità, applicabilità, modificabilità, persistenza e isolamento coerenti per ogni dato.

La matrice canonica è [`operational-view-parity.json`](../../src/domain/official-catalog/operational-view-parity.json). Contiene una riga per ciascuno dei 715 campi ufficiali visibili ed è generata deterministicamente dal catalogo qualificato:

```bash
npm run generate:operational-parity-map
```

Il JSON non si modifica manualmente. Ogni riga registra percorso e identità canonici, Quadro, area operativa, oggetto professionale, cardinalità, applicabilità, produttore del valore e proprietà runtime da provare.

## Fonti di qualificazione

La qualificazione usa tre livelli distinti:

1. XSD, istruzioni, specifiche e controlli ufficiali qualificano identità, tipo, cardinalità, applicabilità e formule esplicite.
2. Il comportamento dell’applicativo pubblico SuccessioniOnLine SUC13 documenta chi produce 257 valori: 255 dipendono da questa evidenza per la qualificazione corrente, mentre 2 importi EF conservano la qualifica primaria più forte già esplicitata dalle istruzioni ufficiali.
3. Le decisioni di prodotto qualificano la destinazione operativa, senza cambiare identità o semantica fiscale.

L’evidenza applicativa compatta è [`successionionline-field-evidence.json`](../../src/domain/official-catalog/successionionline-field-evidence.json). È riproducibile con:

```bash
npm run generate:successionionline-field-evidence -- --source-dir=/percorso/ai/jar
```

Il generatore accetta soltanto `SUC13_ResSUC13.jar` e `XMLConverter_PropertiesREG2013.jar` con le impronte SHA-256 attese, incrocia i mapping record e i controlli UI con la matrice e rifiuta inventari diversi da 257 righe. Il repository conserva soltanto l’evidenza derivata necessaria alla qualificazione o alla sua conferma; non contiene codice decompilato dell’applicativo. Quando una fonte ministeriale statica attribuisce già esplicitamente l’inserimento professionale, questa prevale sull’evidenza applicativa osservata, che resta registrata come provenienza secondaria.

L’esito sui 257 campi riesaminati è:

| Produttore qualificato | Campi | Significato |
| --- | ---: | --- |
| Professionista | 230 | Controllo diretto, wizard o finestra specializzata dell’applicativo ufficiale |
| Automatico | 19 | Calcolo, presenza del Quadro o identificativo prodotto dal software |
| Riservato all’ufficio | 8 | Dato visibile nel modello ma non prodotto dal professionista né da Sequent |

Questa evidenza non autorizza deduzioni per somiglianza: ogni promozione conserva record, controllo e provenienza del singolo campo.

## Modalità canoniche

- `inserito`: valore fornito dal professionista; entrambe le viste modificano lo stesso campo canonico;
- `derivato`: valore ottenuto da una relazione `derivedFrom` esplicita;
- `gestito-automaticamente`: valore prodotto da una regola deterministica o dalla stessa esecuzione fiscale confermata;
- `gestione-contestuale`: automatico nella dichiarazione ordinaria e nelle sostitutive 2/3, input professionale nella sostitutiva 1;
- `riservato-ufficio`: valore consultabile, ma mai prodotto o modificato da Sequent.

La distribuzione corrente è:

| Modalità | Campi |
| --- | ---: |
| Inserito | 644 |
| Gestito automaticamente | 56 |
| Riservato all’ufficio | 8 |
| Derivato | 5 |
| Gestione contestuale | 2 |
| Non determinato | 0 |

Tutte le 715 righe hanno revisione semantica `qualificata`, destinazione definitiva e copertura statica `coperto`. Non restano modalità candidate, blocker semantici o campi privi di destinazione.

## Regole automatiche e riservate

- Le 16 caselle `CasellaEA`–`CasellaER` valgono `1` quando lo snapshot contiene un valore significativo del Quadro corrispondente, anche se tale valore è automatico, altrimenti `0`.
- `IdentificativoProdSoftware` è prodotto da Sequent e vale `SEQUENT`.
- `Frontespizio/ImportoDaVersare` e `QuadroEF/.../ImpostaCalcolata/Imposta` provengono dalla liquidazione fiscale deterministica.
- I totali EE ed EF già qualificati restano prodotti dalla stessa funzione di calcolo.
- I due numeri di circoscrizioni usano la mappa Comune amministrativo-conservatoria estratta da `SRC-39`: sono automatici nella prima dichiarazione e nelle sostitutive 2/3; nella sostitutiva 1 il professionista indica le nuove circoscrizioni entro il massimo ufficiale.
- I quattro campi `CampiServizio` e i quattro indirizzi F24 riservati all’ufficio sono visibili in sola lettura in entrambe le viste. Sequent non li genera e rifiuta ogni scrittura UI/server.

La mappa territoriale versionata contiene 7 999 codici comunali, 139 conservatorie e 345 codici tavolari senza conservatoria ordinaria. Il generatore ne verifica fonte, impronta, integrità e unicità.

## Copertura e applicabilità

`coperto` descrive una proprietà statica della riga: destinazione, produttore e comportamento UI sono qualificati. Non basta da solo a dimostrare il round-trip runtime.

La prova runtime deve invece dimostrare, usando la matrice come inventario unico:

1. Vista Quadri → Vista operativa e Vista operativa → Vista Quadri;
2. persistenza dopo chiusura e riapertura di SQLite;
3. isolamento per dichiarazione, soggetto, bene e occorrenza;
4. cardinalità, ordine e rimozione delle occorrenze ripetibili;
5. applicabilità per tipo di dichiarazione, condizioni XSD e `choice`;
6. stessa fonte e sola lettura per derivati, automatici e riservati all’ufficio;
7. ricalcolo deterministico e mancata eredità di un calcolo confermato;
8. conflitti di revisione senza sovrascrittura silenziosa;
9. copia iniziale controllata e indipendenza delle dichiarazioni successive;
10. pochi E2E rappresentativi che provino il cablaggio UI, senza duplicare 715 casi browser.

I campi applicabili ed editabili per tipo sono:

| Dichiarazione | Campi applicabili | Editabili | Sola lettura |
| --- | ---: | ---: | ---: |
| Prima | 712 | 641 | 71 |
| Sostitutiva 1 | 715 | 646 | 69 |
| Sostitutiva 2 | 715 | 644 | 71 |
| Sostitutiva 3 | 715 | 644 | 71 |

I due input aggiuntivi della sostitutiva 1 sono i conteggi contestuali delle circoscrizioni. I tre campi non applicabili alla prima dichiarazione appartengono agli estremi della dichiarazione precedente.

## Destinazioni operative

Le otto aree proprietarie restano esaustive:

| Area operativa | Campi |
| --- | ---: |
| Patrimonio | 295 |
| Devoluzione | 120 |
| Persone | 116 |
| Imposte e pagamenti | 101 |
| Riepilogo finale | 30 |
| Panoramica | 29 |
| Controlli finali | 13 |
| Documenti | 11 |

`Dati da verificare` è una superficie trasversale e non possiede campi. `Cronologia` resta secondaria. Le aree mostrano soltanto gli oggetti presenti nella pratica: il conteggio del catalogo non equivale al numero di controlli simultaneamente renderizzati.

## Identità e dichiarazioni successive

I 207 campi EH appartengono allo snapshot della dichiarazione selezionata:

- 128 hanno identità `declarationId + fieldId`;
- 79 aggiungono `occurrenceId` in 6 gruppi ripetibili;
- la dichiarazione successiva riceve una copia iniziale e poi evolve con revisione autonoma;
- non esiste un riferimento vivo alla dichiarazione sorgente.

La copia generale è controllata: conserva i campi applicabili e azzera intenzionalmente `DecorrenzaTerminePresentazione`, che deve essere rivalutata per la dichiarazione successiva. Automatici e identificativo dell’esecuzione fiscale non vengono ereditati; sono prodotti da un nuovo calcolo della successiva.

## Evidenza runtime corrente

[`operational-parity.test.ts`](../../tests/unit/operational-parity.test.ts) prova inventario 715/715, generazione deterministica, destinazioni, modalità e regola di editabilità condivisa con la UI.

[`operational-parity-roundtrip.test.ts`](../../tests/integration/operational-parity-roundtrip.test.ts) esercita la matrice al confine server/domain:

- tutti i 644 input, raggruppati in 59 famiglie per Quadro, area, oggetto, scope e applicabilità, nei due versi con doppia riapertura;
- 641/646/644/644 input sui quattro tipi di dichiarazione;
- 260 campi XSD condizionali in 21 contesti;
- tutte le 11 famiglie `choice` interamente editabili, su quattro tipi di dichiarazione, distinguendo alternative obbligatorie e opzionali e identità miste;
- 305 input soggetto/bene su 610 identità divergenti;
- 103 input occurrence in 11 famiglie, con tre occorrenze, riordino, rimozione e pulizia delle conferme;
- 207 campi EH su 286 identità, copia in una sostitutiva e isolamento successivo;
- copia generale di 744 identità sorgente in 743 identità iniziali della sostitutiva, con l’unica esclusione qualificata della decorrenza;
- 5 derivati, 58 automatici applicabili alla prima dichiarazione e 8 campi riservati all’ufficio;
- scritture stale in entrambi i versi e persistenza dello snapshot invariato.

Gli E2E rappresentativi provano il cablaggio browser per input professionale, soggetto, bene, occurrence EH, derivato, automatico fiscale, casella Quadro, gestione contestuale delle circoscrizioni e campo riservato all’ufficio.

## Stato della dichiarazione di parità

La precedente distinzione `458 coperti / 252 parziali / 5 mancanti` è superata dall’evidenza applicativa e dalle regressioni runtime. Nel modello ufficiale corrente la matrice è staticamente completa 715/715 e la suite parametrica dimostra le proprietà runtime richieste per tutte le modalità.

Questo esito non sostituisce i gate generali di pubblicazione, il collaudo visivo né la verifica DIZ end-to-end. Un cambiamento di XSD, applicativo SUC13, regole fiscali o catalogo invalida la qualificazione interessata finché generatori e regressioni non vengono rieseguiti.
