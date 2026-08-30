# Sequent — Master Plan

## Piano completo di prodotto, architettura, implementazione, validazione e handover

- **Documento canonico:** `docs/MASTER_PLAN.md`
- **Stato:** approvato per l'avvio dei technical spike e dello sviluppo, subordinatamente ai validation gate indicati
- **Riferimenti strutturali confrontati:** Master Plan di Routally e Hub Fatture
- **Owner di prodotto:** Matteo
- **Destinatari:** Codex e sviluppatori incaricati
- **Lingua dell'interfaccia:** italiano
- **Nome prodotto:** Sequent
- **Descrizione ufficiale:** Assistente per le dichiarazioni di successione
- **Sigla tecnica:** `SEQ`, riservata a requisiti, log tecnici e documentazione; non deve comparire nell'interfaccia ordinaria
- **Repository previsto:** GitHub pubblico, codice visibile ma senza licenza d'uso implicita
- **Ambiente canonico:** unica istanza Sequent sulla VPS OCI; Codex sviluppa nello stesso host in un checkout Git separato dal runtime e dai dati operativi; nessun ambiente Development, Staging o Production distinto
- **Bootstrap iniziale:** l'owner consegna a Codex un solo ZIP; Codex verifica, trasferisce, crea il layout VPS e inizializza il repository senza delegare comandi manuali all'owner
- **Obiettivo primario:** ridurre drasticamente il lavoro manuale necessario per predisporre dichiarazioni di successione partendo dai documenti già disponibili, mantenendo pieno controllo professionale e interoperabilità modificabile con SuccessioniOnLine
- **Pacchetto ufficiale vincolante:** tutti gli artefatti identificati dal manifest macchina, con l'albero XSD estratto e verificato, costituiscono la baseline normativa, semantica, formale e tecnica obbligatoria del perimetro iniziale

> Questo documento consolida tutte le decisioni utili maturate durante la progettazione preliminare di Sequent. La conversazione originaria non deve essere necessaria per comprendere, progettare, implementare, testare, distribuire o mantenere il prodotto.
>
> Sequent opera in un dominio fiscale e successorio. Codex non deve trasformare un'informazione plausibile in una regola applicativa senza fonte ufficiale, evidenza osservata e approvazione dell'owner. Le dichiarazioni, i calcoli e i file prodotti devono essere verificabili, versionati e sempre sottoposti al controllo finale di SuccessioniOnLine.
>
> Il pacchetto ufficiale vincolante è trattato come specifica primaria: modello visibile, Fascicoli 1 e 2, aggiornamenti ufficiali qualificati, guida ufficiale al calcolo, specifiche SUC13 e XSD macchina-leggibili non sono materiale orientativo ma requisiti da tradurre integralmente in catalogo, regole, validazioni, UI, allegati e test.

---

## Indice

- [0. Come usare questo documento](#0-come-usare-questo-documento)
- [1. Sintesi esecutiva](#1-sintesi-esecutiva)
- [2. Visione, problema e opportunità](#2-visione-problema-e-opportunità)
- [3. Contesto operativo e profilo d'uso](#3-contesto-operativo-e-profilo-duso)
- [4. Definizione e principi del prodotto](#4-definizione-e-principi-del-prodotto)
- [5. Scope e non-scope iniziale](#5-scope-e-non-scope-iniziale)
- [6. Criteri di successo](#6-criteri-di-successo)
- [7. Terminologia e modello concettuale](#7-terminologia-e-modello-concettuale)
- [8. Architettura dell'informazione e navigazione](#8-architettura-dellinformazione-e-navigazione)
- [9. Dashboard operativa](#9-dashboard-operativa)
- [10. Creazione e acquisizione di una pratica](#10-creazione-e-acquisizione-di-una-pratica)
- [11. Workspace della pratica](#11-workspace-della-pratica)
- [12. Revisione, fonti e coda Da verificare](#12-revisione-fonti-e-coda-da-verificare)
- [13. Documenti, originali e trasformazioni](#13-documenti-originali-e-trasformazioni)
- [14. Pipeline documentale e OCR](#14-pipeline-documentale-e-ocr)
- [15. Codex: ruolo, limiti e operating model](#15-codex-ruolo-limiti-e-operating-model)
- [16. Estrazione, affidabilità e applicazione dei dati](#16-estrazione-affidabilità-e-applicazione-dei-dati)
- [17. Gerarchia delle fonti, conflitti e apprendimento](#17-gerarchia-delle-fonti-conflitti-e-apprendimento)
- [18. Motore di devoluzione](#18-motore-di-devoluzione)
- [19. Motore di calcolo](#19-motore-di-calcolo)
- [20. Motore normativo e conformità ufficiale](#20-motore-normativo-e-conformità-ufficiale)
- [21. Checklist documentale, allegati e output](#21-checklist-documentale-allegati-e-output)
- [22. Procedimento successorio e dichiarazioni successive](#22-procedimento-successorio-e-dichiarazioni-successive)
- [23. Interoperabilità DIZ](#23-interoperabilità-diz)
- [24. Round-trip con SuccessioniOnLine](#24-round-trip-con-successionionline)
- [25. Ciclo di vita e stati della pratica](#25-ciclo-di-vita-e-stati-della-pratica)
- [26. Anagrafiche e beni riutilizzabili](#26-anagrafiche-e-beni-riutilizzabili)
- [27. Scadenze essenziali e metadati operativi](#27-scadenze-essenziali-e-metadati-operativi)
- [28. Ricerca globale](#28-ricerca-globale)
- [29. Salvataggio, revisioni e storico](#29-salvataggio-revisioni-e-storico)
- [30. Chiusura, archiviazione e cancellazione](#30-chiusura-archiviazione-e-cancellazione)
- [31. Offline: obiettivi e perimetro](#31-offline-obiettivi-e-perimetro)
- [32. Sincronizzazione e conflitti offline](#32-sincronizzazione-e-conflitti-offline)
- [33. Browser e mobile](#33-browser-e-mobile)
- [34. Autenticazione e sessioni](#34-autenticazione-e-sessioni)
- [35. Sicurezza, privacy e protezione dati](#35-sicurezza-privacy-e-protezione-dati)
- [36. Logging e diagnostica](#36-logging-e-diagnostica)
- [37. Backup e ripristino](#37-backup-e-ripristino)
- [38. Architettura tecnica](#38-architettura-tecnica)
- [39. Modello dati e persistenza](#39-modello-dati-e-persistenza)
- [40. Coda lavori e processi server](#40-coda-lavori-e-processi-server)
- [41. Toolchain e dipendenze](#41-toolchain-e-dipendenze)
- [42. Formati e limiti di caricamento](#42-formati-e-limiti-di-caricamento)
- [43. Infrastruttura VPS e istanza unica](#43-infrastruttura-vps-e-istanza-unica)
- [44. Separazione da Hub Fatture](#44-separazione-da-hub-fatture)
- [45. Sviluppo VPS-first e dati reali](#45-sviluppo-vps-first-e-dati-reali)
- [46. Repository e workflow Git](#46-repository-e-workflow-git)
- [47. Architettura della documentazione](#47-architettura-della-documentazione)
- [48. Strategia di test](#48-strategia-di-test)
- [49. Benchmark OCR e Codex](#49-benchmark-ocr-e-codex)
- [50. Performance e affidabilità](#50-performance-e-affidabilità)
- [51. Monitoraggio e incidenti](#51-monitoraggio-e-incidenti)
- [52. Versioning, release e aggiornamenti](#52-versioning-release-e-aggiornamenti)
- [53. Brand, UI, accessibilità e localizzazione](#53-brand-ui-accessibilità-e-localizzazione)
- [54. Costi, sostenibilità e ownership](#54-costi-sostenibilità-e-ownership)
- [55. Technical spike e validation gate](#55-technical-spike-e-validation-gate)
- [56. Milestone di implementazione](#56-milestone-di-implementazione)
- [57. Risk register essenziale](#57-risk-register-essenziale)
- [58. Modalità degradate essenziali](#58-modalità-degradate-essenziali)
- [59. Requisiti fondamentali](#59-requisiti-fondamentali)
- [60. Decisioni condizionate dagli spike](#60-decisioni-condizionate-dagli-spike)
- [61. Decisioni esplicitamente sostituite](#61-decisioni-esplicitamente-sostituite)
- [62. Quality bar finale](#62-quality-bar-finale)
- [63. Fonti ufficiali vincolanti e riferimenti tecnici](#63-fonti-ufficiali-vincolanti-e-riferimenti-tecnici)
- [64. Approvazione e handover](#64-approvazione-e-handover)

---

# 0. Come usare questo documento

## 0.1 Fonte canonica e gerarchia delle fonti ufficiali

Questo Master Plan definisce prodotto, architettura, sequenza e criteri di accettazione. Le regole di compilazione, calcolo e trasmissione derivano invece dal **pacchetto ufficiale vincolante** descritto nel capitolo omonimo e identificato dal manifest macchina.

| Domanda                                                                                                    | Fonte canonica                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Cosa deve fare Sequent come prodotto                                                                       | decisione più recente approvata dall'owner, quindi questo Master Plan                                                                      |
| Quali campi, quadri, etichette e ordine mostra il modello                                                  | `SRC-03`, modello ministeriale ufficiale                                                                                                   |
| Qual è il significato operativo e fiscale del frontespizio e dei quadri del Fascicolo 1                    | `SRC-05`, con `SRC-01` come aggiornamento puntuale successivo                                                                              |
| Qual è il significato operativo e fiscale dei quadri EL, EM, EN, EO, EP ed EQ                              | `SRC-04`                                                                                                                                   |
| Qual è la struttura XML corrente, con tipi, ordine, cardinalità, enumerazioni e dipendenze                 | `SRC-08`, archivio XSD macchina-leggibile; `SRC-07` ne è la rappresentazione documentale e annotata                                        |
| Quali controlli tecnici successivi al 2 luglio 2025 prevalgono                                             | `SRC-09`, per le sole modifiche espressamente indicate, da riconciliare con `SRC-08` e `SRC-07`                                            |
| Come si calcola l'imposta di successione in autoliquidazione per le successioni aperte dal 1° gennaio 2025 | `SRC-10`, insieme alle condizioni applicabili di `SRC-05`, `SRC-04`, `SRC-08` e `SRC-09`                                                   |
| Quale disciplina si applica in base alla data di apertura della successione                                | `SRC-16`, letto con gli atti di modifica `SRC-18`–`SRC-22` e, per il tema deciso, con `SRC-27`                                             |
| Quali chiarimenti e codici di pagamento accompagnano la riforma dal 2025                                   | `SRC-11`–`SRC-14`, senza far prevalere circolari o risoluzioni sulla legge                                                                 |
| Quali interessi e coefficienti usare per usufrutto, rendite e pensioni                                     | la coppia annuale pertinente fra `SRC-23`–`SRC-26`, selezionata per periodo                                                                |
| Quale versione del controllo ufficiale e quali archivi territoriali usare                                  | `SRC-15` e `SRC-32`–`SRC-40` per il software conservato, confrontati con i canali vivi; lettura corrente del servizio indicato da `SRC-30` |
| Quale struttura DIZ è accettata                                                                            | corpus osservato e round-trip sulla versione qualificata di SuccessioniOnLine, senza mai rilassare i vincoli del pacchetto ufficiale       |
| Quale file è trasmissibile                                                                                 | XSD e controlli SUC13 correnti, quindi controllo obbligatorio con il software ufficiale Agenzia/Sogei                                      |
| Perché esiste una scelta difficile da invertire                                                            | ADR approvato                                                                                                                              |
| Cosa fa oggi il software                                                                                   | codice, configurazione, migrazioni e test dell'HEAD esatto                                                                                 |
| Come si esegue un'operazione                                                                               | runbook corrente                                                                                                                           |
| Cosa ha suggerito Codex                                                                                    | output della run; mai fonte canonica senza validazione                                                                                     |

Regole di prevalenza:

1. Costituzione, leggi e decreti legislativi governano le regole giuridiche nel periodo in cui sono applicabili. `SRC-27` prevale per il tema e il periodo decisi dalla Corte costituzionale.
2. `SRC-11` approva il pacchetto 2025; `SRC-12` e `SRC-13` lo chiariscono e `SRC-14` disciplina i codici di pagamento, ma nessuno di questi atti può modificare una norma primaria.
3. `SRC-01` prevale su `SRC-05` soltanto per le parti delle istruzioni che dichiara di modificare.
4. `SRC-09` prevale su `SRC-08` e `SRC-07` soltanto per gli elementi e i controlli tecnici che dichiara di modificare, inserire o eliminare.
5. `SRC-08` è la fonte macchina-leggibile corrente per sintassi, namespace, tipi, sequenze, cardinalità, enumerazioni e import XSD; `SRC-07` è la relativa documentazione umana. Una divergenza fra i due blocca la regola interessata finché non viene risolta.
6. `SRC-10` è la fonte specialistica per il procedimento di autoliquidazione dal 1° gennaio 2025, nei limiti delle norme, delle istruzioni e delle specifiche applicabili.
7. Le coppie annuali `SRC-23`/`SRC-24` e `SRC-25`/`SRC-26` valgono soltanto per il periodo dichiarato; non si sostituisce un valore storico con quello più recente.
8. `SRC-15` documenta il rilascio del controllo ufficiale; `SRC-32`–`SRC-40` ne conservano pagina di distribuzione, programmi, manuali e deposito SUC13; `SRC-28`–`SRC-31` aiutano il percorso operativo. Nessuna di queste fonti sostituisce modello, XSD o norme e la versione corrente va riletta dal canale vivo prima della qualificazione.
9. `SRC-02`, `SRC-06` e `SRC-17` sono conservati come lineage e materiale di regressione; non governano una pratica quando esiste una fonte successiva applicabile.
10. Il nome visibile `Quadro EI` resta quello del modello, mentre il mapping tecnico corrente usa `QuadroEI_new` quando previsto dagli XSD correnti.
11. Un contrasto non risolto dalla gerarchia blocca la regola interessata: Sequent non sceglie autonomamente una lettura plausibile.
12. Fonti secondarie, memoria del modello, articoli, software concorrenti e output Codex possono aiutare a individuare un problema, ma non sostituiscono né correggono silenziosamente il pacchetto ufficiale.
13. Il comportamento osservato di SuccessioniOnLine può rivelare una divergenza, ma non modifica da solo il catalogo: la divergenza viene registrata, riprodotta e risolta contro una fonte ufficiale aggiornata.
14. Una fonte ufficiale successiva richiede un nuovo bundle immutabile e una migrazione deliberata del catalogo; non viene applicata automaticamente a pratiche esistenti.

## 0.2 Stati delle decisioni

- **Confermato:** decisione da implementare.
- **Default tecnico:** dettaglio affidato all'implementatore; scegliere la soluzione più semplice compatibile.
- **Technical Gate:** prova indispensabile prima delle funzioni che dipendono da un'incertezza reale.
- **Rinviato:** escluso dal perimetro iniziale senza essere abbandonato.
- **Superato:** proposta sostituita; non va reintrodotta senza nuova approvazione.

Le decisioni fiscali non verificate non sono mai default tecnici. Un dato non qualificato resta da verificare o viene gestito manualmente.

## 0.3 Change control

Codex non può autonomamente:

- cambiare la forma del prodotto, lo stack o l'hosting;
- aggirare il gate DIZ costruendo prima l'app completa;
- introdurre API OpenAI a consumo, provider AI o storage esterni non approvati;
- modificare regole fiscali, coefficienti o mapping DIZ senza fonte e test;
- trasformare una deduzione Codex in decisione professionale;
- pubblicare dati reali o documenti dei clienti su GitHub o CI;
- ridurre il controllo umano, il round-trip DIZ o la recuperabilità dei dati;
- ignorare, reinterpretare o sostituire una regola del pacchetto ufficiale senza una nuova fonte ufficiale approvata;
- dichiarare supportato un campo, un quadro o una casistica non presenti nel catalogo ufficiale qualificato.

Un ADR è richiesto soltanto per scelte stabili, costose da invertire o che cambiano il perimetro. Le normali scelte implementative vivono nel codice e nei test.

## 0.4 Principio di completezza

Una funzione è completa quando copre, dove applicabile:

- dominio e invarianti;
- provenienza dei dati;
- persistenza e recupero;
- comportamento online/offline previsto;
- errori e casi degradati;
- uso da tastiera e semantica accessibile;
- test pertinenti;
- compatibilità con browser e piattaforme dichiarati.

Non è necessario creare documentazione, gate o audit separati quando un test, una PR o un runbook breve forniscono già la prova sufficiente.

## 0.5 Documentazione

La cronologia Git è l'unico storico del Master Plan. Il documento descrive sempre lo stato corrente e non riceve una nuova versione per ogni modifica.

Ogni informazione variabile ha una sola fonte canonica:

- milestone e sequenza di implementazione vivono soltanto nel capitolo «Milestone di implementazione»;
- versioni tecniche esatte vivono nei manifest eseguibili, nel lockfile e nella CI;
- identità, date, dimensioni e digest delle fonti ufficiali vivono in `src/domain/official-catalog/source-manifest.json`;
- divergenze e stato degli overlay vivono nei cataloghi macchina pertinenti;
- lo stato operativo corrente si legge da HEAD, gate e configurazione privata, non da dichiarazioni narrative replicate.

README, contratti, runbook e istruzioni descrivono responsabilità, capacità, gate e procedure stabili. Non duplicano milestone corrente, versioni esatte, date di progetto, digest o inventari già rappresentati in una fonte canonica. Le date normative, fiscali o identificative restano dove sono parte del dominio o dell'identità di una fonte.

Documenti iniziali sufficienti:

- `docs/MASTER_PLAN.md`;
- ADR soltanto quando necessari;
- contratto DIZ e contratto dati quando esiste comportamento reale;
- runbook dell'istanza VPS e backup/restore;
- Brand Foundation approvata;
- `README.md`, `AGENTS.md`, `SECURITY.md` e `CHANGELOG.md`.

Non creare cartelle vuote, registri paralleli, evidence pack o audit formali per simulare maturità.

## 0.6 Versioni tecniche

Il piano fissa famiglie e policy; i pin esatti vivono in `package.json`, lockfile, Dockerfile, workflow e manifest. La documentazione non li replica.

Sono confermati:

- Node.js su linea stabile qualificata, con pin, digest e rollback compatibile;
- TypeScript come compilatore principale, con compatibility layer soltanto finché richiesto dal tooling;
- Svelte e SvelteKit sulla linea stabile qualificata;
- dipendenze esatte;
- Oxfmt e Oxlint senza Prettier o ESLint diretti nel perimetro iniziale.

## 0.7 Regola di lettura per gli agenti

Prima di un intervento, Codex legge sempre:

1. «Come usare questo documento»;
2. «Definizione e principi del prodotto» e «Scope e non-scope iniziale»;
3. i Technical Gate pertinenti;
4. «Decisioni esplicitamente sostituite»;
5. le sole sezioni funzionali e tecniche toccate dal lavoro.

Il DIZ richiede sempre «Interoperabilità DIZ», «Round-trip con SuccessioniOnLine» e i relativi Technical Gate. OCR/Codex richiedono i capitoli sulla pipeline documentale, Codex, estrazione, gerarchia delle fonti e benchmark. Offline richiede i capitoli su offline, sincronizzazione, browser e mobile. Database e backup richiedono i capitoli su backup, persistenza e coda lavori. Qualunque modifica di runtime, deploy o operazioni sulla VPS richiede anche i capitoli su infrastruttura, separazione da Hub Fatture, sviluppo VPS-first, workflow Git e release.

Qualunque intervento su dominio, quadri, calcoli, allegati, DIZ o telematico richiede inoltre «Pacchetto ufficiale vincolante», «Motore normativo e conformità ufficiale» e il contratto di conformità ufficiale derivato.

## 0.8 Pacchetto ufficiale vincolante

### 0.8.1 Identità del bundle

Identità, URL ufficiale, nomi, date, ruoli, dimensioni, hash, metodi di digest e stato di ogni fonte risiedono esclusivamente in `src/domain/official-catalog/source-manifest.json`. Il Master Plan usa gli ID stabili `SRC-*` e non replica questi metadati.

`docs/OFFICIAL_SOURCES_MANIFEST.md` spiega come leggere e verificare la fonte macchina. `src/domain/official-catalog/delta-overlays.json` è la fonte unica per overlay, anomalie e mapping irrisolti.

### 0.8.2 Archivio XSD corrente

Il progetto conserva sia lo ZIP originale sia l'albero estratto, senza rinominare o appiattire i percorsi perché gli `schemaLocation` sono relativi. Main schema, conteggio, dependency closure, file preservati, hash e stato delle verifiche risiedono nel manifest macchina.

La verifica di bootstrap e ogni verifica successiva accertano che tutti gli XSD dichiarati siano XML well-formed e che il main schema compili con sole dipendenze locali e senza accesso alla rete.

### 0.8.3 Custodia e riproducibilità

Tutti gli artefatti dichiarati dal manifest devono essere disponibili localmente in:

```text
private/official-sources/
```

con gli alias canonici indicati dal manifest macchina. La stessa directory contiene:

```text
manifest.json
xsd-manifest.json
xsd/
software/
```

La directory contiene esclusivamente fonti ministeriali pubbliche ed è versionata insieme al repository. Dati reali, documenti cliente, DIZ operativi e segreti restano esclusi da Git. Il repository contiene inoltre:

```text
scripts/official-sources/verify.ts
src/domain/official-catalog/
docs/contracts/official-compliance.md
tests/fixtures/official/
```

- `verify.ts` controlla inventario esatto, presenza, dimensione, pagine e SHA-256 delle fonti, impronte ufficiali dichiarate, integrità degli archivi, albero XSD, digest compositi e compilazione del main schema;
- il catalogo derivato, i validator e le fixture sintetiche sono versionati nel repository;
- le fixture non contengono pratiche reali né riproduzioni estese dei PDF;
- la rigenerazione del catalogo è bloccata se manca un artefatto, un hash non coincide, un percorso XSD cambia o lo schema non compila;
- `SRC-02`, `SRC-06` e `SRC-17` restano disponibili per ricostruzione storica e regressione; le fonti correnti sono organizzate nel manifest per modello e tecnica, norme, chiarimenti, valori annuali, materiale operativo e programmi ufficiali;
- l’acquisizione di `SRC-11`–`SRC-40` non equivale alla loro applicazione: `delta-overlays.json` registra i gruppi ancora da riconciliare e blocca le capacità interessate;
- il programma di installazione più grande è versionato con Git LFS; il bundle non include applicazioni installate, configurazioni personali, credenziali o pratiche;
- il runtime operativo può usare gli artefatti derivati già qualificati, ma non può dichiarare aggiornata una regola senza il bundle sorgente verificato;
- ogni dichiarazione registra `officialSourceBundleId`, versione del catalogo e versione delle regole applicate.

Una futura revisione ufficiale genera un nuovo source bundle e nuovi artefatti derivati. Non genera una versione autonoma del Master Plan: la cronologia Git del piano resta l'unico storico del documento.

---

# 1. Sintesi esecutiva

Sequent è una web app privata, single-user e self-hosted per predisporre dichiarazioni di successione a partire da fascicoli documentali già disponibili. Automatizza l'acquisizione, la classificazione, l'OCR, l'estrazione, il controllo, la devoluzione, i calcoli, la preparazione degli allegati e la generazione di una pratica modificabile in SuccessioniOnLine.

Il flusso canonico è:

```text
fascicolo documentale
→ classificazione e OCR
→ estrazione deterministica
→ analisi Codex su comando
→ revisione con fonte e pagina
→ devoluzione e calcoli versionati
→ controlli e checklist
→ generazione DIZ
→ modifica e controllo in SuccessioniOnLine
→ reimportazione e riconciliazione
→ telematico, stampa, ricevute ed esiti
→ fascicolo conclusivo
```

Sequent non trasmette la dichiarazione e non sostituisce il software ufficiale. SuccessioniOnLine resta il controllo operativo finale e la fonte del file telematico; Sequent mantiene però l'intero procedimento, il round-trip dei dati, le evidenze e la storia delle dichiarazioni successive.

Il prodotto sarà:

- usato soltanto da Matteo per circa dieci pratiche l'anno nello studio in cui lavora;
- accessibile da Safari e Chrome su Mac, Chrome ed Edge su Windows, Safari su iPhone e iPad;
- una web app pura, senza applicazione desktop, app nativa o installazione PWA richiesta;
- funzionante offline, per il perimetro previsto, sulle pratiche esplicitamente selezionate sul dispositivo;
- ospitato sulla VPS OCI Ampere A1 esistente con Ubuntu 24.04 LTS;
- fortemente separato da Hub Fatture, condividendo soltanto host e Caddy;
- sviluppato con SvelteKit, TypeScript e Node, con SQLite e filesystem locale;
- eseguito in un solo processo/container applicativo, con OCR, conversioni e Codex come processi figli;
- dotato di OCR locale sul server e Codex SDK autenticato con la subscription ChatGPT/Codex;
- privo di API OpenAI a consumo e di fallback automatici a modelli locali;
- gratuito al netto della subscription Codex e delle risorse già possedute;
- sviluppato in un repository GitHub pubblico senza licenza d'uso implicita;
- aggiornato sull'istanza operativa soltanto tramite release stabili approvate e deploy automatico controllato; il checkout di lavoro sulla stessa VPS non viene mai eseguito direttamente come servizio live.

Il primo gate del progetto è l'interoperabilità DIZ. Prima di costruire l'app completa, il laboratorio deve dimostrare un round-trip reale e ripetibile con l'installazione qualificata di SuccessioniOnLine su macOS e deve escludere dipendenze del formato da percorsi, separatori o codifiche del sistema operativo. A sviluppo concluso, un eventuale collaudo con SuccessioniOnLine su Windows è facoltativo e best-effort: la disponibilità dell'ambiente e l'esecuzione della prova non sono criteri di gate, milestone o release. Se il writer DIZ puro non risultasse affidabile, è ammesso un componente locale o Java minimo e limitato all'interoperabilità; la web app resta il prodotto principale.

---

# 2. Visione, problema e opportunità

## 2.1 Problema

La predisposizione corrente con SuccessioniOnLine richiede molto inserimento manuale di dati già presenti in:

- certificati di morte e documenti anagrafici;
- documenti d'identità e codici fiscali;
- stati di famiglia e relazioni parentali;
- visure catastali PDF o XML;
- certificazioni bancarie, conti, depositi e titoli;
- mutui, fatture e passività;
- testamenti, rinunce e altri atti;
- fogli Excel, documenti Word, scansioni e fotografie;
- DIZ, telematici, stampe e ricevute di pratiche precedenti.

Il lavoro manuale produce duplicazione, rischio di trascrizione, difficoltà nel risalire alla fonte e perdita di allineamento quando la pratica viene modificata nel programma ufficiale.

## 2.2 Tesi di prodotto

Un dato già contenuto nei documenti deve essere estratto una volta, collegato alla fonte, verificato al livello appropriato e riutilizzato in tutto il procedimento. Le operazioni deterministiche devono essere codice; Codex deve assistere soltanto dove la variabilità documentale e linguistica lo rende utile.

## 2.3 Promessa

> **Sequent trasforma il fascicolo della successione in una pratica verificabile, calcolata e modificabile in SuccessioniOnLine.**

## 2.4 Opportunità

Con circa dieci pratiche annue non serve un gestionale commerciale esteso. Serve uno strumento mirato che:

- riduca il tempo di preparazione;
- mantenga il controllo umano;
- impari in modo approvato dalle correzioni ricorrenti;
- conservi l'intero fascicolo;
- sia disponibile su più computer e offline;
- non introduca costi ricorrenti ulteriori.

## 2.5 Alternative considerate

### Successione Web dell'Agenzia

Non è il percorso operativo perché spesso l'utente non dispone della delega necessaria per accedere alla posizione del contribuente. Non può quindi essere la fondazione del prodotto.

### Software professionali commerciali

Possono importare visure, calcolare quote o produrre DIZ, ma introducono costi e non risolvono necessariamente l'estrazione dell'intero fascicolo eterogeneo. Il vincolo economico esclude licenze ricorrenti.

### Preparazione caso per caso da parte di un assistente

Utile come prototipo e benchmark, ma non sufficiente come processo stabile: manca riuso, audit, sincronizzazione, controlli e manutenzione del formato.

### Automazione dei clic in SuccessioniOnLine

Più fragile del DIZ e sensibile agli aggiornamenti dell'interfaccia. È ammessa soltanto come parte di un fallback locale documentato, qualora il formato DIZ non sia interoperabile.

### Generazione del solo file telematico

Non soddisfa il requisito di riaprire e modificare la pratica in SuccessioniOnLine. Il formato primario di interoperabilità è il DIZ; il telematico è un artefatto ufficiale successivo.

### App desktop sincronizzata tramite cloud drive

Scartata per conflitti, percorsi, dipendenza da servizi non progettati come database applicativo e gestione macchinosa fra dispositivi.

### LLM per ogni operazione

Scartata. OCR, parsing, calcoli, mapping e controlli deterministici non richiedono una LLM. Codex è riservato ai documenti variabili, alle ambiguità e all'assistenza.

---

# 3. Contesto operativo e profilo d'uso

## 3.1 Utente

- unico utente proprietario: Matteo;
- uso professionale interno allo studio;
- circa dieci dichiarazioni di successione l'anno;
- dispositivi personali con libertà di installazione e amministrazione;
- dati reali utilizzabili nei volumi privati della VPS e, per prove rischiose, esclusivamente tramite copie temporanee isolate;
- clienti già informati del trattamento dei dati.

## 3.2 Dispositivi e browser

| Piattaforma | Browser                  |
| ----------- | ------------------------ |
| macOS       | Safari e Chrome          |
| Windows     | Chrome ed Edge           |
| iPhone/iPad | Safari, senza app nativa |

SuccessioniOnLine è installato e funzionante su macOS, che è la piattaforma canonica per le prove ufficiali di interoperabilità DIZ. Non è richiesta un'installazione Windows né una VM dedicata. Se a sviluppo concluso sarà disponibile un ambiente Windows, Codex potrà eseguire un collaudo facoltativo con il software ufficiale; la mancata disponibilità o esecuzione non blocca il progetto, mentre un difetto DIZ riproducibile eventualmente osservato segue i normali criteri di arresto. Il supporto della web app nei browser Windows resta invece parte della matrice obbligatoria.

## 3.3 Vincoli economici

- nessun costo obbligatorio oltre alla subscription Codex già posseduta;
- nessuna API OpenAI a consumo;
- uso della VPS OCI esistente;
- hostname Dynu gratuito;
- nessun SaaS esterno necessario per storage, database, sincronizzazione o autenticazione;
- nessun piano commerciale, billing o distribuzione pubblica.

## 3.4 Volumi

I fascicoli occupano poco spazio. I limiti tecnici devono comunque coprire PDF, foto, ZIP e scansioni anomale senza esaurire disco o memoria.

---

# 4. Definizione e principi del prodotto

## 4.1 Definizione

Sequent è un assistente operativo per dichiarazioni di successione, non un sostituto dell'interpretazione professionale né del controllo ufficiale.

## 4.2 Principi

1. **Fonte visibile.** Ogni dato estratto indica documento, pagina, estratto o ritaglio e metodo.
2. **Determinismo prima dell'AI.** Regole, calcoli, mapping e controlli sono codice versionato.
3. **Codex come acceleratore.** Codex interpreta e propone, ma non decide silenziosamente.
4. **La correzione umana prevale.** Un valore corretto manualmente non viene sovrascritto da una rianalisi.
5. **Meglio vuoto che inventato.** Un dato non trovato è accettabile; un dato critico errato presentato come affidabile blocca il rilascio.
6. **Originali immutabili.** Ogni trasformazione produce un derivato.
7. **Round-trip, non sola esportazione.** Le modifiche in SuccessioniOnLine devono poter tornare in Sequent.
8. **Storia riproducibile.** Regole, modello, prompt, fonti e revisioni restano versionati.
9. **Offline senza finzioni.** Il browser offre il massimo possibile; le funzioni server attendono la rete.
10. **Nessuna dipendenza invisibile.** Nessun cloud drive, API a consumo o servizio esterno obbligatorio.
11. **Fail-visible.** Conflitti, divergenze e parti non supportate sono espliciti.
12. **Una pratica completa.** Il fascicolo prosegue fino a telematico, ricevute, esiti e chiusura.
13. **Semplicità proporzionata.** Un solo utente e pochi fascicoli non giustificano architetture enterprise.
14. **Interfaccia operativa.** Sequent indica il prossimo passo senza procedere autonomamente nelle decisioni rilevanti.
15. **Conformità source-bound.** Campi, etichette, regole, codici, allegati e controlli sono derivati dal pacchetto ufficiale con provenienza fino a fonte, pagina, sezione e percorso XSD.
16. **Official-source-first.** Il pacchetto ufficiale corrente prevale su memoria, prassi non documentata, output AI e comportamento preesistente dell’app.
17. **Nessuna perdita silenziosa.** Un elemento ufficiale non supportato o non riconciliato resta preservato e blocca l’export interessato.
18. **Linguaggio professionale, non informatico.** L’interfaccia parla come una pratica di studio: usa termini comprensibili a un avvocato e descrive l’azione o il risultato, non l’implementazione. Parole come `DIZ`, source bundle, ruleset, schema, pipeline, job, run, runtime, configurazione e identità tecnica restano nei dettagli diagnostici o nella documentazione di sviluppo. Nei percorsi ordinari diventano, secondo il contesto, “pratica modificabile”, “fonti ufficiali applicate”, “regole applicate”, “controlli”, “elaborazione”, “attività”, “preferenze” e “dati del titolare”. La regola vale per tutte le milestone e per ogni nuovo testo rivolto all’utente, senza sostituire le denominazioni legali ufficiali dei modelli e dei quadri.

---

# 5. Scope e non-scope iniziale

## 5.1 Scope funzionale

Il perimetro iniziale comprende:

- dichiarazioni telematiche correnti compatibili con il modello ufficiale per successioni aperte dal 3 ottobre 2006;
- prima dichiarazione e dichiarazioni sostitutive di tipo 1, 2 e 3, oltre alle ulteriori dichiarazioni che secondo le istruzioni si affiancano senza sostituire la precedente;
- riconoscimento e blocco delle pratiche che devono continuare a usare il modello precedente, il Modello 4 o la presentazione presso l’ufficio;
- esclusione dall’automazione dei modelli cartacei, pur mostrando chiaramente il percorso ufficiale alternativo;
- successioni legittime e testamentarie;
- persone fisiche, eredi, legatari, rinunce, rappresentazione e relazioni;
- immobili e terreni;
- conti, depositi, titoli e rapporti cointestati;
- altri beni comuni;
- passività comuni;
- donazioni precedenti;
- agevolazione prima casa;
- volture e relativi dati;
- allegati e fascicolo conclusivo;
- importazione e generazione DIZ;
- reimportazione del DIZ modificato;
- importazione telematico, stampa, ricevute, esiti e quietanze;
- motore assistito di devoluzione;
- motore completo di calcolo e confronto;
- regole versionate per data di apertura e modello;
- modalità manuale assistita per casistiche non ancora automatizzate;
- copertura formale del frontespizio e dei quadri EA, EB, EC, ED, EE, EF, EG, EH, EI, EL, EM, EN, EO, EP, EQ ed ER secondo `SRC-03`;
- mapping tecnico coerente con `Frontespizio`, `QuadroEA`, `QuadroEB`, `QuadroEC`, `QuadroED`, `QuadroEE`, `QuadroEF`, `QuadroEG`, `QuadroEH`, `QuadroEI_new`, `QuadroEL`, `QuadroEM`, `QuadroEN`, `QuadroEO`, `QuadroEP`, `QuadroEQ` e `QuadroER` secondo `SRC-08`, `SRC-07` e `SRC-09`;
- conformità dei dati, degli allegati e del pacchetto finale al source bundle identificato dal manifest macchina.

Il supporto di una tipologia di dichiarazione non implica interpretazione automatica di ogni casistica giuridica. Aziende, partecipazioni complesse, beni esteri, trust, eredità giacenti e fattispecie internazionali possono essere completati manualmente **solo quando il modello telematico ufficiale ammette la fattispecie**. La modalità manual assisted non può aggirare un divieto: trust di scopo puro, ipotesi miste in cui non tutti i beni sono conferiti nel trust e ogni altro caso rinviato al Modello 4 o all’ufficio restano fuori dall’export Sequent.

## 5.2 Scope tecnico

- web app pura e responsive;
- offline selettivo per le pratiche scelte;
- server self-hosted;
- database SQLite;
- storage documentale su filesystem;
- OCR e conversioni server-side;
- Codex tramite subscription;
- ricerca full-text;
- audit essenziale e diagnostica temporanea opt-in;
- backup manuale e restore amministrativo da runbook;
- deploy automatico da release approvata.

## 5.3 Non-scope

Non rientrano nel perimetro iniziale:

- presentazione telematica diretta da Sequent;
- sostituzione di SuccessioniOnLine;
- modelli cartacei non vigenti;
- multiutente, ruoli, inviti o collaborazione simultanea;
- SaaS pubblico, pricing, pagamenti o abbonamenti;
- app desktop, app nativa iOS/iPadOS o Android;
- installazione PWA o distribuzione tramite store;
- integrazione diretta con Gmail, PEC, OneDrive, Dropbox, Google Drive o cartelle sorvegliate;
- notifiche e-mail o browser per le attività della pratica;
- ricerca semantica globale;
- API OpenAI a consumo;
- fallback automatico a modelli locali;
- analytics esterni o telemetria commerciale;
- firma digitale automatica;
- invio di documenti ai clienti;
- CRM, timesheet, fatturazione o recupero crediti;
- importazione massiva obbligatoria dell'intero archivio storico;
- sito pubblico, landing page o attività di marketing;
- backup automatico giornaliero fuori dalla VPS.

---

# 6. Criteri di successo

## 6.1 Successo operativo

Sequent è pronto quando una pratica reale nuova attraversa:

```text
caricamento fascicolo
→ elaborazione tecnica
→ analisi Codex
→ revisione
→ devoluzione
→ calcoli
→ checklist
→ DIZ
→ SuccessioniOnLine
→ reimportazione
→ telematico e ricevute
→ chiusura
```

senza interventi tecnici e con un risparmio sostanziale rispetto all'inserimento manuale.

## 6.2 Successo DIZ

Il writer/parser supera `TG-DIZ`: round-trip su più pratiche con SuccessioniOnLine su macOS, salvataggio ufficiale, generazione telematico, allegati, preservazione dei blocchi sconosciuti e test automatici di portabilità per percorsi e codifiche. La disponibilità e l'esecuzione dell'eventuale collaudo finale su Windows non concorrono alla chiusura del gate; una divergenza DIZ riproducibile emersa dalla prova resta invece un difetto effettivo.

## 6.3 Successo dell'estrazione

- zero valori critici errati accettati silenziosamente;
- zero fonti inventate;
- ogni campo critico corretto oppure esplicitamente da verificare;
- almeno 98% di precisione sui campi non critici del benchmark qualificato;
- risultati separati per estrattori deterministici, OCR e Codex.

## 6.4 Introduzione controllata

Prima del percorso ordinario:

1. round-trip DIZ qualificato;
2. qualificazione reale di Codex attraverso Sequent e acquisizione applicativa dei cinque DIZ privati già disponibili;
3. ricostruzione end-to-end di 5–10 pratiche storiche;
4. benchmark OCR/Codex finale;
5. prima pratica reale lavorata in parallelo al metodo abituale;
6. riconciliazione di tutte le divergenze critiche;
7. approvazione dell'owner al go-live.

## 6.5 Successo della conformità ufficiale

Sequent non è pronto finché:

- gli artefatti e l'albero XSD coincidono con i rispettivi manifest macchina;
- il catalogo copre tutti i campi visibili e tecnici del perimetro telematico;
- ogni regola applicativa possiede provenienza ufficiale;
- gli overlay correnti `SRC-01` e `SRC-09` risultano applicati e testati, mentre `SRC-02` e `SRC-06` risultano riconciliati come lineage;
- gli allegati finali rispettano formato e dimensioni ufficiali;
- il pacchetto supera XSD, validator interni e controllo di SuccessioniOnLine/Agenzia-Sogei;
- `TG-COMPLIANCE` è chiuso.

---

# 7. Terminologia e modello concettuale

| Termine                 | Significato                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Procedimento**        | fascicolo complessivo relativo a un defunto                                                                 |
| **Dichiarazione**       | singola dichiarazione iniziale o successiva dentro il procedimento                                          |
| **Pratica**             | termine UI per il procedimento, salvo contesto specifico                                                    |
| **Revisione**           | snapshot immutabile dello stato di una dichiarazione                                                        |
| **Documento originale** | file ricevuto, mai modificato                                                                               |
| **Documento derivato**  | versione convertita, OCR, ritagliata, unita o preparata                                                     |
| **Fonte**               | documento, pagina e posizione da cui deriva un dato                                                         |
| **Fatto**               | valore estratto o inserito, con origine e stato                                                             |
| **Decisione**           | scelta umana autorevole, per esempio devoluzione o fonte prevalente                                         |
| **Source bundle**       | insieme immutabile degli artefatti ufficiali e dell’albero XSD identificati da manifest e hash              |
| **Catalogo ufficiale**  | rappresentazione macchina-leggibile di modello, istruzioni, XSD, controlli e delta con provenienza puntuale |
| **Ruleset**             | insieme eseguibile delle regole derivate da uno specifico source bundle                                     |
| **Controllo**           | verifica deterministica con severità                                                                        |
| **DIZ**                 | file di lavoro apribile e modificabile in SuccessioniOnLine                                                 |
| **Telematico**          | file finale generato dal software ufficiale                                                                 |
| **Blocco sconosciuto**  | parte DIZ non ancora interpretata ma preservata                                                             |
| **Job**                 | elaborazione persistente server-side                                                                        |
| **Copia offline**       | cache operativa del browser, mai considerata backup                                                         |
| **Regola qualificata**  | regola versionata con fonte, test e approvazione                                                            |

---

# 8. Architettura dell'informazione e navigazione

## 8.1 Navigazione principale

La navigazione desktop e mobile resta minimale:

```text
Dashboard
Pratiche
Documenti
Impostazioni
```

`Da verificare`, anagrafiche, scadenze essenziali e storico sono viste interne o contestuali, raggiungibili dalla Dashboard e dalla pratica.

## 8.2 Doppia prospettiva della pratica

Ogni dichiarazione offre due viste degli stessi dati:

1. **Vista operativa per oggetti**, predefinita;
2. **Vista Quadri**, organizzata secondo il modello ufficiale.

La vista per quadri usa denominazioni, ordine, sezioni, numerazione dei campi e testi legali di `SRC-03`; non è richiesta una copia pixel-perfect del PDF, ma deve esistere una corrispondenza uno-a-uno fra campo visibile, campo canonico Sequent e percorso tecnico SUC13. Il passaggio non duplica i dati.

## 8.3 Sezioni della vista operativa

- Panoramica;
- Documenti;
- Persone;
- Patrimonio;
- Devoluzione;
- Imposte e pagamenti;
- Controlli finali;
- Riepilogo finale.

Le otto aree sono destinazioni professionali dei medesimi campi canonici mostrati nella Vista Quadri. `Persone` comprende defunto, beneficiari, presentatori e altri soggetti; `Patrimonio` usa schede tipizzate per immobili, rapporti, aziende, altri beni e passività. La dichiarazione selezionata è contesto della pratica, non una sezione: il cambio e la creazione di una dichiarazione successiva restano disponibili dalla Panoramica e dalle azioni contestuali. `Da verificare` compare soltanto in presenza di elementi pendenti; scadenze e cronologia restano superfici trasversali o secondarie. Documenti richiesti e allegati sono riuniti in `Documenti`.

---

# 9. Dashboard operativa

La Dashboard non è analitica. Deve mostrare cosa richiede attenzione:

- pratiche recenti;
- pratiche con errori bloccanti;
- verifiche pendenti;
- documenti mancanti, illeggibili o discordanti;
- OCR e Codex in corso, completati o falliti;
- pratiche pronte per la devoluzione;
- pratiche pronte per il DIZ;
- conflitti offline;
- aggiornamenti ufficiali rilevati;
- stato dell'ultimo backup manuale;
- snapshot tecnici e aggiornamenti applicativi rilevanti;
- scadenze imminenti o superate.

L'assistente operativo suggerisce il passo successivo e azioni massive sicure, per esempio confermare dati strutturati già validati. Non avvia Codex, non conferma la devoluzione e non esporta DIZ senza comando.

---

# 10. Creazione e acquisizione di una pratica

## 10.1 Tre ingressi

La schermata `Nuova pratica` propone:

1. **Importa tutti i documenti** — percorso consigliato;
2. **Importa un DIZ esistente**;
3. **Compilazione manuale guidata**.

Non esiste un wizard obbligatorio preliminare che richieda dati già presenti nei documenti.

## 10.2 Percorso documentale

L'utente può trascinare file, cartelle supportate dal browser, ZIP e fotografie. Sequent:

- crea la pratica vuota;
- calcola hash;
- conserva gli originali;
- classifica i documenti;
- rileva possibili gruppi e separazioni;
- estrae i primi identificativi;
- propone defunto, data di apertura e tipologia;
- avvia automaticamente le elaborazioni tecniche gratuite;
- attende il comando esplicito per Codex.

## 10.3 Importazione da DIZ

`Importa pratica da DIZ` crea direttamente un procedimento o aggiunge una dichiarazione a quello esistente. Deve importare tutto ciò che è rappresentabile e preservare in forma grezza ciò che non è ancora interpretato.

## 10.4 Compilazione manuale

Il percorso manuale resta completo e non dipende dall'AI. Gli stessi controlli, calcoli e DIZ devono essere disponibili.

---

# 11. Workspace della pratica

## 11.1 Layout desktop

Il workspace affiancato è il pattern canonico:

```text
navigazione/sezioni | campi e controlli | documento o fonte
```

Caratteristiche:

- selezionando un campo si apre la pagina di origine;
- la zona rilevante viene evidenziata quando disponibile;
- il documento può essere ingrandito;
- ogni pannello può essere ridotto o nascosto;
- più fonti possono essere confrontate nello stesso contesto;
- la vista Quadri usa lo stesso sistema di fonti;
- il layout deve funzionare su schermi comuni di Mac e Windows senza richiedere monitor ultrawide.

## 11.2 Layout mobile

Su schermi piccoli i pannelli diventano schede o fogli sovrapposti. L'intera pratica resta consultabile e modificabile, ma:

- riorganizzazioni massive;
- confronti complessi;
- merge articolati;
- generazione e reimportazione DIZ;
- amministrazione avanzata

sono contrassegnati come ottimizzati per Mac o PC.

## 11.3 Autosave visibile

L'area di lavoro mostra sempre uno stato coerente:

- `Salvato`;
- `Salvataggio…`;
- `Solo sul dispositivo`;
- `In attesa di sincronizzazione`;
- `Conflitto`;
- `Sola lettura`.

Non deve essere possibile chiudere una scheda e perdere silenziosamente modifiche già accettate dall'interfaccia.

## 11.4 Scorciatoie

Il perimetro iniziale offre scorciatoie documentate per:

- confermare e passare al successivo;
- rifiutare una proposta;
- aprire la fonte;
- muoversi fra verifiche;
- ricerca globale;
- snapshot nominato;
- rotazione, classificazione e riordino delle pagine;
- annullamento delle operazioni reversibili.

Non esistono scorciatoie che confermano devoluzioni, deroghe o esportazioni senza riepilogo esplicito.

---

# 12. Revisione, fonti e coda Da verificare

## 12.1 Coda centralizzata

`Da verificare` raccoglie:

- campi mancanti;
- OCR a bassa o media affidabilità;
- proposte Codex;
- contraddizioni fra documenti;
- parti non supportate;
- documenti illeggibili;
- checklist incompleta;
- differenze con SuccessioniOnLine;
- controlli bloccanti, avvisi e informazioni.

Ogni elemento apre il campo nella relativa sezione o nel quadro ministeriale.

## 12.2 Presentazione di una proposta

La scheda di revisione mostra:

- valore proposto;
- valori alternativi;
- documento e pagina;
- ritaglio o estratto;
- metodo: strutturato, testo nativo, OCR, regola, Codex, calcolo o manuale;
- affidabilità;
- regola o versione del prompt;
- eventuale conflitto;
- azioni `Conferma`, `Modifica`, `Rifiuta`, `Ignora`, `Apri fonte`.

## 12.3 Correzioni manuali

Una correzione manuale:

- diventa autorevole;
- blocca la sovrascrittura automatica;
- registra autore, data e motivazione facoltativa o obbligatoria secondo il caso;
- mantiene il valore precedente nell'audit;
- può essere sostituita soltanto da un comando esplicito.

## 12.4 Azioni massive

Sono ammesse soltanto quando il gruppo è omogeneo e sicuro, per esempio:

- conferma di dati strutturati validati;
- assegnazione del tipo a pagine selezionate;
- approvazione di duplicati esatti;
- applicazione di una regola già qualificata.

Interpretazioni Codex, conflitti, devoluzione e deroghe non sono approvabili in massa senza riepilogo elemento per elemento.

---

# 13. Documenti, originali e trasformazioni

## 13.1 Originali immutabili

Ogni file caricato viene conservato byte per byte e identificato tramite SHA-256. Non viene mai riscritto, ottimizzato o sostituito.

Ogni trasformazione produce un derivato collegato all'originale:

- PDF ricercabile;
- pagina renderizzata;
- immagine corretta;
- documento unito o separato;
- anteprima;
- pacchetto allegati;
- conversione Office;
- file firmato importato successivamente.

## 13.2 Composizione e separazione

Sequent propone, senza applicare distruttivamente:

- unione di fotografie o PDF riferiti allo stesso documento;
- separazione di PDF contenenti più documenti;
- riordino delle pagine;
- rotazione;
- raddrizzamento;
- eliminazione di pagine duplicate dal derivato;
- assegnazione del tipo documento.

L'utente può confermare o correggere. Il file ricevuto resta sempre disponibile.

## 13.3 Duplicati e versioni

- byte identici: deduplicazione automatica;
- stesso documento, contenuto aggiornato: entrambi conservati come versioni;
- informazioni discordanti: confronto obbligatorio;
- nessuna regola `ultimo file vince`;
- la fonte scelta come autorevole viene registrata e non sovrascritta da Codex.

## 13.4 Accettazione universale

Qualsiasi file può essere caricato e conservato. Soltanto i formati riconosciuti vengono elaborati automaticamente.

Macro, script e contenuti attivi non vengono eseguiti. Gli archivi devono avere protezioni minime contro path traversal ed espansioni anomale. Nel perimetro iniziale non è prevista una piattaforma antivirus o quarantena dedicata; un file sconosciuto resta inerte e scaricabile.

## 13.5 Stato documento

Ogni documento può essere:

- ricevuto;
- da classificare;
- in elaborazione;
- elaborato;
- da verificare;
- versione superata;
- fonte autorevole;
- allegato candidato;
- allegato incluso;
- non elaborabile automaticamente;
- illeggibile;
- escluso con motivazione.

---

# 14. Pipeline documentale e OCR

## 14.1 Principio

La pipeline usa il metodo più deterministico e meno costoso disponibile:

```text
identificazione formato
→ estrazione nativa
→ conversione se necessaria
→ OCR se necessario
→ parsing/regole
→ Codex solo dove utile
→ revisione
```

## 14.2 PDF nativi

Per i PDF con testo:

- estrazione con Poppler o libreria equivalente qualificata;
- conservazione delle coordinate quando possibile;
- rilevazione di tabelle, pagine e metadati;
- nessun OCR inutile.

## 14.3 PDF scansionati

OCRmyPDF produce un derivato ricercabile e può applicare:

- rotazione;
- deskew;
- pulizia;
- livello testuale;
- ottimizzazione controllata.

Tesseract fornisce anche output TSV o equivalente con coordinate e confidence.

## 14.4 Fotografie e immagini

ImageMagick gestisce:

- conversione HEIC/JPEG/PNG/TIFF/WebP;
- ritaglio;
- contrasto;
- ridimensionamento;
- rotazione;
- correzioni per migliorare l'OCR.

Le trasformazioni devono essere riproducibili e registrate.

## 14.5 Office e OpenDocument

LibreOffice headless è necessario per convertire in modo controllato:

- DOC/DOCX;
- XLS/XLSX;
- ODT/ODS;
- RTF e altri formati supportati.

Le macro restano disabilitate. La conversione avviene senza rete e con limiti di risorse.

## 14.6 XML, fogli e dati strutturati

XML, CSV, XLSX e formati strutturati vengono analizzati direttamente. Le visure e i dati ufficiali strutturati hanno priorità maggiore rispetto all'OCR.

## 14.7 Output della pipeline

Per ogni pagina o documento:

- testo;
- coordinate;
- livello di affidabilità;
- lingua rilevata;
- tipo documento;
- estratti candidati;
- errori e warning;
- derivati prodotti;
- versione degli strumenti;
- hash degli input e output.

## 14.8 Avvio automatico

Al caricamento partono automaticamente:

- hash;
- deduplicazione;
- identificazione formato;
- conversione;
- OCR;
- classificazione e parsing deterministico.

Codex non parte automaticamente. L'utente lo avvia quando il fascicolo è pronto o quando richiede una rianalisi.

---

# 15. Codex: ruolo, limiti e operating model

## 15.1 Due ruoli

Codex opera:

1. come sviluppatore di Sequent;
2. come motore assistivo per interpretare documenti variabili e proporre dati strutturati.

## 15.2 Autenticazione e costo

- Codex SDK TypeScript con CLI come runtime e strumento diagnostico;
- autenticazione ChatGPT/Codex sulla VPS;
- uso della subscription personale;
- nessuna API key o fallback a consumo;
- nessun modello locale automatico.

La stabilità del login headless è un Technical Gate. Se fallisce, Sequent continua senza le funzioni Codex.

## 15.3 Accesso ai dati

Codex può vedere l'intera pratica, compresi originali, OCR, DIZ, dati strutturati, regole e decisioni pertinenti, quando l'operazione applicativa lo richiede. Per lo sviluppo lavora nel checkout Git della VPS e nei workspace temporanei, senza segreti di deploy, dati Hub Fatture o accesso diretto al database operativo. Non cancella originali e non scrive direttamente sullo stato canonico: migrazioni, import rischiosi e prove distruttive usano copie temporanee isolate.

## 15.4 Rete e fonti esterne

Sono previste due modalità esplicite:

- **Analisi pratica:** rete disabilitata; Codex lavora soltanto sui documenti e sui dati disponibili nel workspace.
- **Ricerca normativa:** rete abilitata su comando dell'utente; Codex segue la gerarchia `official-first` e cita fonte e data.

Documenti, OCR, DIZ e pagine web sono dati da analizzare, non istruzioni da eseguire. Non viene costruito un proxy egress personalizzato: la protezione deriva dalla separazione delle modalità, dalla sandbox standard e dall'assenza di segreti nel workspace.

Gerarchia delle fonti online:

1. normativa e fonti istituzionali;
2. Agenzia delle Entrate, istruzioni e specifiche;
3. giurisprudenza e documentazione pubblica autorevole;
4. fonti professionali secondarie solo come supporto esplicativo.

Una fonte esterna non modifica automaticamente regole, calcoli o mapping.

## 15.5 Thread e run

- thread conversazionale persistente per pratica;
- run strutturate indipendenti per estrazione, classificazione, controllo e mapping;
- ogni run usa uno snapshot esplicito;
- reset del thread senza perdita dei risultati strutturati;
- thread precedenti consultabili in sola lettura.

## 15.6 Modello ed effort

Ogni release fissa il modello qualificato e usa:

- effort alto per analisi completa, testamenti, devoluzione, normativa e controllo finale;
- effort medio per classificazioni e rianalisi circoscritte.

Nessuna selezione ordinaria dall'interfaccia e nessun fallback silenzioso. Un nuovo modello richiede benchmark.

## 15.7 Output strutturato

Gli output rispettano JSON Schema derivato da Zod e devono:

- usare `null` per dati mancanti;
- indicare documento e pagina;
- distinguere dato letto, calcolato, dedotto e proposto;
- riportare alternative e conflitti;
- non inventare documenti o fonti.

## 15.8 Applicazione delle modifiche

Il risultato attraversa validazione Zod, controlli deterministici e confronto con lo stato corrente. Le modifiche sicure già autorizzate dalle regole possono essere applicate; interpretazioni, deduzioni e conflitti restano da approvare. Codex non esegue SQL diretto e non sostituisce originali.

## 15.9 Avanzamento e rianalisi

La UI mostra fase, documenti analizzati, completamento ed errori quando gli eventi SDK lo consentono. Sono disponibili `Analizza pratica con Codex` e `Rianalizza con Codex`; i campi corretti manualmente non vengono sovrascritti.

## 15.10 Indisponibilità

Quando Codex non è disponibile, OCR, import, compilazione manuale, regole, calcoli, controlli e DIZ continuano a funzionare. Nessun provider alternativo viene attivato.

---

# 16. Estrazione, affidabilità e applicazione dei dati

## 16.1 Livelli di acquisizione

| Origine                                          | Comportamento                                                                     |
| ------------------------------------------------ | --------------------------------------------------------------------------------- |
| dato strutturato ufficiale validato              | può essere inserito come confermato                                               |
| dato strutturato non ufficiale ma deterministico | inserito con controlli e provenienza                                              |
| testo nativo con regola qualificata              | compilazione automatica, visibilità della fonte                                   |
| OCR ad alta affidabilità                         | compilazione automatica ma evidenziata                                            |
| OCR medio/basso                                  | proposta da verificare                                                            |
| Codex                                            | proposta da verificare, salvo trasformazioni già autorizzate e non interpretative |
| dato dedotto giuridicamente/fiscalmente          | sempre da confermare                                                              |
| inserimento manuale                              | autorevole                                                                        |

## 16.2 Stati del campo

- mancante;
- estratto;
- compilato automaticamente;
- da verificare;
- confermato;
- corretto manualmente;
- calcolato;
- in conflitto;
- non applicabile;
- derogato;
- bloccato.

## 16.3 Soglie

Le soglie di confidence non sono globali. Devono essere calibrate per metodo, tipo documento e campo. Codice fiscale, data del decesso, quota, saldo e rendita richiedono controlli specifici.

## 16.4 Campi critici

Sono critici almeno:

- identità e codice fiscale;
- data e luogo del decesso;
- beneficiari e relazioni;
- quote e devoluzione;
- dati catastali;
- intestazioni e quote di possesso;
- saldi e valori patrimoniali;
- tipologia della dichiarazione;
- agevolazioni;
- campi che modificano imposte o allegati obbligatori.

Un campo critico non può essere accettato silenziosamente se errato.

---

# 17. Gerarchia delle fonti, conflitti e apprendimento

## 17.1 Gerarchia base

1. valore confermato o corretto manualmente;
2. dato strutturato da fonte ufficiale;
3. testo nativo del documento;
4. OCR;
5. interpretazione o deduzione Codex.

La gerarchia non sostituisce il contesto. Data, finalità, periodo di riferimento e autorevolezza del documento possono prevalere sulla semplice recenza.

## 17.2 Conflitti

Un conflitto mostra:

- valori;
- documenti;
- date;
- periodo cui si riferiscono;
- metodo;
- affidabilità;
- regola di priorità applicabile;
- spiegazione Codex facoltativa.

La scelta finale è registrata come decisione e non viene sovrascritta automaticamente.

## 17.3 Regole riutilizzabili

Dopo correzioni ricorrenti, Sequent può proporre una regola specifica per:

- banca;
- tipo documento;
- layout;
- versione;
- campo.

La regola:

- non si attiva da sola;
- richiede approvazione;
- è versionata e reversibile;
- viene testata sul corpus storico;
- non modifica retroattivamente pratiche già revisionate.

---

# 18. Motore di devoluzione

## 18.1 Obiettivo

Automatizzare la parte meccanica della devoluzione senza delegare la decisione professionale.

## 18.2 Input

- parentela;
- coniuge;
- figli e discendenti;
- ascendenti e collaterali;
- rappresentazione;
- rinunce;
- testamento;
- legati;
- premorienza;
- altri fatti rilevanti qualificati.

## 18.3 Comportamento

Il motore:

- traduce le regole e gli esempi di devoluzione del Fascicolo 1, incluso l'Allegato 5, e i controlli SUC13 in casi macchina-leggibili e fixture;
- applica regole deterministiche versionate;
- produce uno o più scenari;
- mostra passaggi e fonti;
- evidenzia assunzioni;
- controlla la quadratura;
- richiede conferma finale;
- blocca clausole ambigue o fattispecie non implementate;
- consente inserimento manuale assistito.

Codex può estrarre e spiegare un testamento, ma non conferma la devoluzione.

## 18.4 Invarianti ufficiali

Il motore applica e testa, per la baseline pertinente, almeno questi vincoli:

- ogni soggetto indicato in attribuzione/devoluzione esiste nel quadro EA con rigo e modulo corretti;
- un soggetto rinunciatario non viene incluso quando le specifiche lo vietano;
- quote, numeratore, denominatore, codice diritto e valore quota rispettano tipi e quadrature ufficiali e sommano all’intero dove richiesto;
- il flag di continuazione crea ulteriori righi senza ripetere i dati identificativi del bene;
- rappresentazione, codice fiscale del rappresentato e grado di parentela rispettano i controlli incrociati EA/frontespizio/EH;
- coniuge o parte dell’unione civile, rinuncia, separazione con addebito e diritto di abitazione rispettano le condizioni ufficiali;
- agevolazioni e riduzioni sono ammesse soltanto nei quadri, sui beni e per i beneficiari previsti, incluse le regole prima casa e precedenti successioni/donazioni;
- trust, trustee, beneficiari finali, grado di parentela e disabilità rispettano le condizioni tecniche e il perimetro telematico;
- testamento e legge estera non vengono ricondotti automaticamente alle quote della successione legittima italiana;
- ogni conflitto o condizione non coperta produce stato `unresolved` e blocca l’export, non una quota plausibile.

Ogni regola conserva `sourceId`, pagina/paragrafo, percorso tecnico e fixture positiva/negativa.

## 18.5 Decisione finale

La conferma registra:

- scenario selezionato;
- quote;
- beneficiari;
- fonti;
- versione delle regole;
- note e deroghe;
- revisione della dichiarazione.

---

# 19. Motore di calcolo

## 19.1 Perimetro

Il motore indipendente comprende almeno:

- valori catastali;
- quote di possesso;
- attivo e passivo;
- rapporti cointestati e quota del defunto;
- franchigie e aliquote;
- agevolazione prima casa;
- imposte ipotecaria e catastale;
- tributi collegati alle volture;
- ripartizione per beneficiario;
- somme, arrotondamenti e quadrature;
- stima delle imposte;
- confronto con SuccessioniOnLine.

## 19.2 Regole

Coefficienti, aliquote e formule:

- non sono sparsi nel codice;
- appartengono a pacchetti normativi versionati;
- hanno fonte e periodo di validità;
- sono testati con casi noti;
- non cambiano pratiche storiche;
- derivano in via specialistica da `SRC-10` per l'autoliquidazione dal 1° gennaio 2025, e sono riconciliati con `SRC-05`, `SRC-04`, `SRC-08`, `SRC-07`, `SRC-09` e `SRC-01`;
- rispettano la disciplina applicabile alla data di apertura della successione, ricostruita da `SRC-16` e dagli atti `SRC-18`–`SRC-22`, senza usare automaticamente la versione più recente;
- usano interessi e coefficienti annuali della coppia pertinente fra `SRC-23`–`SRC-26`;
- applicano `SRC-27` ai casi storici che ricadono nel tema e nel periodo decisi dalla Corte costituzionale;
- riconciliano i chiarimenti e i codici di pagamento di `SRC-11`–`SRC-14` senza trattarli come fonti superiori alla legge;
- trasformano tutti gli esempi ufficiali di calcolo in golden test, senza sostituire le condizioni normative con il solo esempio.

## 19.3 Catena ufficiale di autoliquidazione e fixture

Per le successioni aperte dal 1° gennaio 2025, il motore rappresenta esplicitamente almeno le grandezze e i passaggi definiti da `SRC-10`:

1. `QE` — somma dei valori quota devoluti al beneficiario nei quadri EB, EL, EC, EM, EN, EO, EP, EQ ed ER, escludendo le quote con agevolazioni esenti indicate dalla guida e i cespiti `DN`;
2. `QDN` — quota dei cespiti `DN` del quadro ER;
3. `QP` — quota delle passività ripartite nel quadro ED;
4. `AN = QE + QDN - QP` — attivo netto del beneficiario;
5. `FR` — franchigia unica applicabile al beneficiario, consumata in modo coerente anche quando lo stesso soggetto compare con qualifiche diverse;
6. `QN = AN - FR` — quota netta, mai trattata come base positiva quando il risultato è inferiore a zero;
7. `PR = max(0, 10% × (QN - QDN) - QDN)` — presunzione su denaro, gioielli e mobilia, applicata solo nei casi e con le esclusioni ufficiali, inclusa l'assenza di cespiti `BI` e l'esclusione dei legatari quando prevista;
8. `QTI = QN + PR` — quota totale imponibile;
9. `ISL = QTI × AL` — imposta lorda sulla quota, con aliquota determinata dal grado di parentela e zero per i soggetti non assoggettati;
10. riduzioni per agevolazioni `L`, `Q`, `R`, `F` e art. 25, comma 1, calcolate con le formule ufficiali e i relativi limiti;
11. detrazione dell'imposta estera entro il limite della quota d'imposta italiana riferibile al bene estero;
12. `ISN = ISL - RID - DET.estero` — imposta netta della singola quota;
13. somma delle imposte nette di tutti i soggetti EA e mapping alla Sezione V-bis del quadro EF.

Il ruleset copre inoltre:

- autoliquidazione nel quadro EF dal 1° gennaio 2025 e diverso flusso per date precedenti;
- Sezione V-bis, imposta calcolata/non dovuta/già versata, credito, imposta da versare, tempistica, acconto e rateazione;
- regola corrente per cui `ImpostaDaVersare` è zero quando il risultato è minore o uguale a 10 euro e conseguente assenza della tempistica di pagamento quando richiesta dalle specifiche;
- opzione di pagamento anticipato del trust e relative condizioni;
- imposte ipotecaria e catastale, tassa per i servizi ipotecari e catastali, bollo, tributi speciali, sanzioni, interessi e totale da versare;
- regole ED sulle passività, compresi debiti contratti negli ultimi sei mesi e verifica del familiare a carico nel periodo della spesa;
- franchigia applicata al valore della quota o del legato secondo grado di parentela;
- basi imponibili per piena proprietà, nuda proprietà, usufrutto, uso, abitazione, enfiteusi e concedente;
- valori di terreni e fabbricati ordinari e tavolari, aziende, titoli/fondi/ratei, aeromobili, navi e beni esteri;
- riduzioni per precedenti successioni o donazioni entro cinque anni;
- quadrature dei quadri EE ed EF rispetto ai quadri patrimoniali e a ED.

Gli esempi numerici di `SRC-10`, Fascicolo 1 e Fascicolo 2 — inclusi quota ereditaria, presunzione `DN`, franchigia condivisa, riduzioni, imposta estera, nuda proprietà, debiti degli ultimi sei mesi, precedenti successioni/donazioni e ratei dei titoli — diventano golden test con risultati intermedi e finali. Non possono essere ignorati come testo illustrativo.

## 19.4 Divergenze ufficiali

Quando il risultato differisce da SuccessioniOnLine:

- entrambi i valori restano visibili;
- la pratica torna `Da verificare`;
- Sequent tenta di classificare la causa;
- nessun valore prevale automaticamente;
- la risoluzione richiede una decisione e può generare una fixture di regressione.

---

# 20. Motore normativo e conformità ufficiale

## 20.1 Versioni registrate per dichiarazione

Ogni dichiarazione registra:

- data di apertura della successione;
- versione del modello;
- `officialSourceBundleId`;
- versione del catalogo ufficiale;
- versione del pacchetto normativo/ruleset;
- versione del mapping DIZ;
- versione dei controlli.

## 20.2 Copertura temporale

Sequent copre le successioni compatibili con la procedura telematica descritta dal bundle. Le regole sono selezionate usando la dimensione temporale pertinente, che può essere:

- data di apertura della successione;
- data di presentazione;
- data di un evento sopravvenuto;
- versione del modello o della specifica tecnica;
- versione qualificata di SuccessioniOnLine.

Le regole storiche vengono aggiunte quando servono e validate su pratiche concluse. Sequent non supporta il modello precedente per decessi anteriori al 3 ottobre 2006 né dichiarazioni che devono continuare a usare la modulistica precedente.

## 20.3 Aggiornamenti

Un aggiornamento ufficiale:

- non modifica silenziosamente una pratica;
- crea un nuovo source bundle e un nuovo ruleset;
- mostra le differenze per una pratica aperta;
- mantiene riproducibile la versione precedente;
- segnala versioni non più accettate;
- richiede migrazione esplicita quando necessaria;
- non viene applicato soltanto perché una pagina web o Codex segnala una novità.

## 20.4 Monitoraggio ufficiale

Sequent controlla periodicamente fonti ufficiali configurate per rilevare:

- nuova versione di SuccessioniOnLine;
- nuove specifiche o XSD;
- nuovi modelli e istruzioni;
- correzioni, elenchi di modifiche, provvedimenti, circolari e risoluzioni dell'Agenzia;
- modifiche normative, testi unici, sentenze costituzionali e decreti annuali su interessi e coefficienti;
- aggiornamenti degli archivi ufficiali di uffici, Comuni e Stati esteri;
- nuove versioni di Desktop Telematico e dei moduli di controllo distribuiti dai depositi ufficiali.

Il controllo produce un avviso e una proposta di acquisizione. Nessuna regola viene modificata automaticamente.

## 20.5 Catalogo ministeriale canonico

Prima di congelare il modello dati e prima di dichiarare coperta una versione del modello telematico, Sequent mantiene un catalogo canonico macchina-leggibile, accompagnato da `docs/contracts/data-model.md` e `docs/contracts/official-compliance.md` quando esiste contenuto reale.

Il catalogo copre:

- informativa e frontespizio;
- tutti i campi dei quadri EA, EB, EC, ED, EE, EF, EG, EH, EI, EL, EM, EN, EO, EP, EQ ed ER;
- Allegati 1-5 del Fascicolo 1;
- tipi, enumerazioni, sequenze, choice, cardinalità e annotazioni XSD;
- documenti/allegati richiesti e condizioni di obbligatorietà;
- controlli fra quadri, righi, moduli, soggetti, beni, quote, agevolazioni e riduzioni;
- regole di liquidazione, scadenze, ricevute e volture;
- modifiche introdotte da `SRC-01` e `SRC-09`, con `SRC-02` e `SRC-06` usati come lineage di regressione;
- formule, passaggi ed esempi di autoliquidazione definiti da `SRC-10`;
- struttura e vincoli XSD derivati direttamente da `SRC-08` e riconciliati con `SRC-07`.
- linea temporale delle norme e dei correttivi `SRC-16`–`SRC-22`, con applicabilità legata alla pratica;
- chiarimenti e pagamenti `SRC-11`–`SRC-14`, valori annuali `SRC-23`–`SRC-26` e decisioni vincolanti come `SRC-27`;
- percorso operativo, controlli e archivi correnti documentati da `SRC-15` e `SRC-28`–`SRC-31`, distinguendo gli snapshot dai servizi da leggere dal vivo;
- programmi, manuali e deposito SUC13 conservati in `SRC-32`–`SRC-40`, con controllo della versione sui canali vivi prima della qualificazione.

Per ogni campo o regola registra almeno:

- identificativo stabile Sequent;
- nome e label ufficiale;
- quadro, sezione, rigo/modulo e ordine visibile;
- percorso XML/XSD o stato `non telematico`;
- tipo, formato, cardinalità e normalizzazione;
- obbligatorietà e condizioni di presenza/assenza;
- enumerazioni e codici ammessi;
- dipendenze e controlli cross-field/cross-quadro;
- formula, coefficiente, arrotondamento o regola applicabile;
- possibili origini documentali;
- relazione con soggetti, beni, devoluzione, agevolazioni, riduzioni e allegati;
- comportamento in import, export, DIZ e round-trip;
- livello di supporto: automatico, manual assisted o non qualificato;
- `sourceId`, pagina, paragrafo/heading e, per le specifiche, percorso dell'elemento o del tipo;
- periodo di efficacia e condizione temporale;
- fixture, test e versione del ruleset collegati.

La dichiarazione «tutte le tipologie telematiche vigenti» è soddisfatta soltanto quando il catalogo dimostra copertura esplicita dei campi applicabili. Nessuna costante fiscale, enumerazione o regola di obbligatorietà può vivere esclusivamente in un componente UI o in una funzione priva di provenienza.

## 20.6 Architettura del catalogo derivato

Il catalogo è costruito per riconciliazione, non copiando una singola fonte:

```text
SRC-03 modello visibile
        +
SRC-05/SRC-04 istruzioni semantiche
        +
SRC-01 overlay istruzioni 15 luglio 2025
        +
SRC-10 guida ufficiale al calcolo
        +
SRC-08 XSD macchina-leggibili
        +
SRC-07 documentazione tecnica consolidata
        +
SRC-09 overlay tecnico 15 luglio 2025
        +
SRC-02/SRC-06 lineage e non-regressione
        +
SRC-11/SRC-14 approvazione, chiarimenti e pagamenti
        +
SRC-16/SRC-22 norme e correttivi per periodo
        +
SRC-23/SRC-27 valori annuali e decisioni vincolanti
        +
SRC-15/SRC-28/SRC-31 riferimenti operativi correnti
        +
SRC-32/SRC-40 programmi, manuali e deposito ufficiale
        ↓
official-catalog.json
        ↓
Zod/schema UI/validator/ruleset/test generator/mapping DIZ
```

Artefatti minimi:

```text
src/domain/official-catalog/source-manifest.json
src/domain/official-catalog/xsd-manifest.json
src/domain/official-catalog/form-fields.json
src/domain/official-catalog/semantic-rules.json
src/domain/official-catalog/calculation-rules.json
src/domain/official-catalog/technical-schema.json
src/domain/official-catalog/delta-overlays.json
src/domain/official-catalog/official-catalog.json
```

La struttura tecnica viene estratta direttamente dagli XSD di `SRC-08`; il PDF `SRC-07` serve a verificare annotazioni, diagrammi e resa documentale, non a ricostruire manualmente uno schema già disponibile. L'estrazione automatica può essere assistita da Codex, ma la chiusura di `TG-COMPLIANCE` richiede riconciliazione deterministica e review. Un testo non estratto con certezza viene curato manualmente; non viene completato per analogia.

## 20.7 Regole di compilazione e validazione

Il motore distingue almeno:

1. **layout/model validation:** esistenza e corrispondenza dei campi del modello;
2. **schema validation:** XSD, tipi, sequenze, cardinalità e namespace;
3. **field validation:** pattern, date, importi, quote, codici e formati;
4. **cross-field validation:** dipendenze fra campi dello stesso quadro;
5. **cross-quadro validation:** dipendenze fra EA, beni, devoluzione, EG, EH, EF e altri quadri;
6. **semantic validation:** istruzioni, condizioni, esclusioni e documenti richiesti;
7. **temporal validation:** regole diverse per data di apertura/presentazione;
8. **attachment validation:** formato, dimensione, quantità e presenza;
9. **official validation:** controllo finale con software Agenzia/Sogei.

Gli errori interni devono usare un identificativo stabile e riportare sempre la fonte ufficiale che giustifica il controllo.

## 20.8 Baseline obbligatoria delle modifiche 2025–2026

Il catalogo deve rappresentare e testare integralmente `SRC-01` e `SRC-09`. `SRC-02` e `SRC-06` sono mantenuti per dimostrare la corretta evoluzione verso `SRC-07`/`SRC-08` e impedire la reintroduzione di elementi superati.

Il bundle acquisito il 27 agosto 2026 aggiunge inoltre una linea normativa e operativa che deve essere riconciliata prima della chiusura del gate:

- provvedimento, circolari e codici di pagamento `SRC-11`–`SRC-14`;
- controllo SUC13 2.3.1 e archivi territoriali correnti `SRC-15` e `SRC-30`;
- testo vigente, riforme, testi unici e correttivi `SRC-16`–`SRC-22`;
- interessi e coefficienti annuali 2025 e 2026 `SRC-23`–`SRC-26`;
- sentenza costituzionale `SRC-27` per le pratiche storiche interessate;
- guida operativa, Modello 4 e servizio ricevute `SRC-28`, `SRC-29` e `SRC-31` per ricevute, allegati e casi residui ammessi.
- pagina di distribuzione, programma macOS, utilità, manuali e deposito del controllo `SRC-32`–`SRC-40`, da confrontare con i canali vivi prima della prova ufficiale.

Ogni gruppo resta `reconciliation-required` in `delta-overlays.json` finché non ha regole con periodo di efficacia, test e riferimenti puntuali. Il semplice possesso del PDF non abilita il calcolo o l’invio.

Checklist minima di non regressione, che non sostituisce i testi completi:

- chiarimenti sulle volture per immobili nel regime del Libro fondiario e sulle province autonome;
- rimozione, nelle istruzioni ER, delle precedenti lettere a) e b) sui saldi di conto corrente;
- regole ED sui debiti contratti negli ultimi sei mesi e sulla condizione di familiare a carico;
- franchigie precisate per quota o legato in funzione del grado di parentela;
- restrizioni correnti delle agevolazioni `N`, `D`, `R`, `F` e `Q` in base al grado di parentela;
- divieto corrente di agevolazioni e riduzioni in presenza delle devoluzioni trust indicate;
- coerenza delle riduzioni su tutti i righi quando è presente `Valore precedenti successioni` e obbligatorietà di `ValorePrecSucc` quando si applica l'art. 25, comma 1;
- condizioni aggiornate di `ImpostaBollo_CopiaConforme`, `ImpostaNonDovuta`, `ImpostaCalcolata`, `ImpostaDaVersare` e `TempisticaPagamento`;
- coerenza dei duplicati EA per `TipoSoggetto`, `GradoParentela` e persona con disabilità;
- regole correnti per codice fiscale, denominazione, trust senza beneficiario finale e soggetti non persone fisiche;
- modifica del tipo del campo `Provincia` indicata dall'overlay tecnico;
- condizioni di presenza del Quadro EF, incluse data di apertura e dichiarazione sostitutiva tipo 3;
- nuove regole EF per imposta ipotecaria/catastale, trust, circoscrizioni, bollo e tributi speciali;
- eliminazione di `FormalitaIpotecarie` e `Pagine_Numero` nella lineage storica;
- introduzione di `SezioneVBis_ImpostaSuccessione`, `ImpostaSuccessione` e righe collegate per imposta, acconto, rateazione, sanzioni e interessi;
- condizioni aggiornate per documenti d'identità, `Altro`, `PrimaCasa` e Quadro EH;
- introduzione di `CodiceCarica`, `CodiceFiscaleRappresentato`, `FlagTrasferimentoPrima`, `FlagSedeLavoro`, `FlagResidenteEstero2`, `QuadroEI_new`, `NumeroChiamati` e `UfficiDiTrascrizione`;
- eliminazione di `FlagResidenteEstero`, `QuadroEI` tecnico precedente, `QuadroES` e degli altri elementi esplicitamente rimossi;
- aggiornamenti a `PortatoreHandicap`, `Denominazione`, `CodiceFiscaleBeneficiario`, valori `TX8` e `DatoEM_Type`.

Ogni voce di `SRC-01`, `SRC-02` e `SRC-09` deve essere marcata nel report di riconciliazione come `incorporata`, `superata da fonte successiva`, `non applicabile` oppure `unresolved`, con riferimento al percorso XSD corrente. La checklist non autorizza implementazioni approssimative.

## 20.9 Comportamento in caso di lacuna o conflitto

Se un campo del modello non ha mapping tecnico, una regola tecnica non ha significato semantico chiaro o due fonti risultano incompatibili:

- il catalogo marca l'elemento `unresolved`;
- l'export DIZ/telematico interessato viene bloccato;
- la UI consente consultazione e inserimento manuale solo se non crea un file apparentemente conforme;
- viene aperta una fixture minima e una verifica ufficiale;
- la risoluzione aggiorna catalogo, test e contratto, non soltanto il codice chiamante.

---

# 21. Checklist documentale, allegati e output

## 21.1 Checklist dinamica

La checklist è derivata dalle sezioni `QUALI DOCUMENTI OCCORRONO`, `DOCUMENTI DA CONSERVARE`, Quadro EG, Quadro EH e dalle condizioni tecniche SUC13.

In base alla pratica, Sequent:

- propone documenti obbligatori, condizionati e consigliati;
- distingue allegato telematico, documento fonte, documento da conservare e prova successiva;
- segnala mancanti, duplicati, illeggibili, scaduti o contraddittori;
- collega ogni allegato a rigo EG, dichiarazione EH, agevolazione, riduzione, passività o quadro pertinente;
- gestisce documenti di identità, testamenti, inventari, passività, albero genealogico, dichiarazioni sostitutive, imposte estere, trust, prima casa e ulteriori categorie descritte nelle istruzioni;
- impedisce lo stato `Pronta` con mancanze bloccanti, salvo deroga soltanto quando le fonti consentono comunque la presentazione;
- conserva il riferimento puntuale alla regola ufficiale che ha generato la richiesta;
- distingue espressamente documenti da allegare da documenti da conservare, includendo quando applicabili modello trasmesso/sottoscritto, originali delle dichiarazioni sostitutive, documenti d’identità, seconda ricevuta e F24/ricevuta di pagamento.

## 21.2 Preparazione allegati telematici

Sequent può accettare come originali tutti i formati definiti in «Formati e limiti di caricamento», ma il **derivato finale da allegare alla dichiarazione** deve rispettare `SRC-08` e le relative prescrizioni documentate in `SRC-07`:

- formato TIF/TIFF oppure PDF/A-1a/PDF/A-1b;
- TIF/TIFF in bianco e nero, risoluzione non superiore a 300 DPI e compressione CCITT Group IV;
- massimo 5 MB per singolo file allegato;
- suddivisione controllata quando un documento supera 5 MB;
- validazione reale del profilo PDF/A, non semplice controllo dell'estensione;
- verifica di leggibilità dopo conversione, split o compressione;
- originale immutabile sempre conservato;
- descrizione e nome file coerenti con il rigo EG e con il catalogo.

La preparazione comprende selezione, conversione, unione/separazione, rotazione, raddrizzamento, compressione, OCR, naming e anteprima. Un allegato non conforme blocca il pacchetto finale. Sequent non firma automaticamente; un file firmato può essere conservato e, se necessario, trasformato in un derivato ammesso senza perdere l'originale.

## 21.3 Output operativi

Oltre al DIZ:

- riepilogo completo;
- checklist;
- prospetto soggetti e devoluzione;
- prospetto immobili;
- prospetto rapporti finanziari;
- altri beni e passività;
- calcolo imposte e confronto;
- elenco allegati;
- anomalie e deroghe;
- dossier finale.

Formati: PDF e, quando utile, DOCX o XLSX.

## 21.4 Layout degli output

Non esistono template documentali preesistenti dello studio e non devono essere richiesti come prerequisito. Gli output della v1 usano layout predefiniti e deterministici mantenuti nel codice dell'applicazione.

La v1 non include:

- importazione di modelli dello studio;
- libreria o editor di template;
- placeholder configurabili dall'utente;
- personalizzazione di intestazioni e testi standard;
- macro o codice eseguibile nei documenti.

Una futura personalizzazione documentale richiede una decisione esplicita e non fa parte del perimetro corrente.

## 21.5 Report di conformità

Ogni export DIZ/pacchetto allegati produce un report leggibile e macchina-leggibile con:

- source bundle e ruleset applicati;
- quadri e moduli presenti;
- controlli superati, avvisi e blocchi;
- conformità degli allegati;
- dimensione per file e totale compresso stimato;
- differenze rispetto al modello/XSD;
- deroghe motivate;
- stato del controllo ufficiale, quando disponibile.

---

# 22. Procedimento successorio e dichiarazioni successive

## 22.1 Un procedimento per defunto

```text
Procedimento Mario Rossi
├── prima dichiarazione
├── dichiarazione sostitutiva tipo 1
├── dichiarazione sostitutiva tipo 2
├── dichiarazione sostitutiva tipo 3
└── eventuali ulteriori dichiarazioni che si affiancano alla precedente
```

Secondo il bundle ufficiale:

- tipo 1: modifiche che comportano nuova trascrizione e/o voltura;
- tipo 2: modifiche che non comportano nuova trascrizione e nuova voltura;
- tipo 3: integrazione o modifica dei soli allegati, con frontespizio e Quadro EG;
- una dichiarazione sostitutiva sostituisce integralmente la precedente nei casi previsti e deve riportare gli estremi della prima dichiarazione;
- dichiarazioni presentate da soggetti o in modalità che non producono sostituzione restano eventi distinti nello stesso procedimento.

Ogni dichiarazione conserva snapshot, source bundle, ruleset, calcoli, DIZ, allegati, telematico e ricevute propri.

## 22.2 Condivisione controllata

Documenti, soggetti e beni possono essere condivisi nel procedimento. Una dichiarazione già presentata resta immutabile; una successiva parte da uno snapshot esplicito, applica le regole del proprio tipo e conserva le differenze. L'app non tratta “correttiva” o “integrativa” come etichette generiche quando il modello richiede uno dei codici tecnici 1, 2 o 3.

## 22.3 Importazione storica

Il perimetro iniziale non richiede migrazione massiva. Le pratiche storiche vengono importate quando servono, tramite:

- DIZ;
- documenti;
- telematico e ricevute;
- pacchetto Sequent.

---

# 23. Interoperabilità DIZ

## 23.1 Priorità assoluta

Il laboratorio DIZ precede l'app completa. Nessuna UI ampia, motore documentale completo o attivazione del servizio operativo deve diventare una scusa per rinviare il gate.

## 23.2 Obiettivi

- identificare il formato;
- leggere DIZ reali;
- mappare strutture e versioni;
- conservare parti sconosciute;
- scrivere DIZ validi;
- gestire allegati e percorsi;
- escludere dipendenze del DIZ da percorsi assoluti, separatori, codifiche, terminatori di riga e metadati specifici del sistema operativo;
- aprire, modificare e salvare nel programma ufficiale;
- dimostrare che ogni valore scritto è rappresentabile nel modello e conforme al catalogo ufficiale;
- non reintrodurre elementi eliminati nella lineage `SRC-02`/`SRC-06` né omettere quelli presenti nelle fonti correnti `SRC-08`/`SRC-09`.

## 23.3 Reverse engineering per interoperabilità

L'analisi del formato DIZ e, se necessario, dei componenti del software ufficiale è ammessa **solo nella misura necessaria a ottenere interoperabilità** e subordinatamente ai presupposti legali e contrattuali applicabili.

Prima di decompilare o analizzare componenti non documentati occorre:

1. verificare le condizioni d'uso della copia di SuccessioniOnLine utilizzata;
2. documentare che l'analisi riguarda una copia legittimamente utilizzata;
3. verificare che le informazioni necessarie non siano già facilmente e adeguatamente disponibili tramite specifiche pubbliche o altri canali ufficiali;
4. limitare l'attività alle parti indispensabili per lettura, scrittura, preservazione e round-trip del DIZ;
5. usare le informazioni ottenute esclusivamente per l'interoperabilità di Sequent;
6. non redistribuire codice, classi, risorse, JAR, output decompilati o altri componenti protetti;
7. conservare nel repository soltanto implementazioni autonome, fixture sintetiche ed evidenze che non riproducano materiale protetto.

Quando necessarie e compatibili con tali condizioni sono previste:

- ispezione di header e byte;
- verifica di ZIP, XML, JSON, SQLite o serializzazione Java;
- confronto di file differenziali;
- analisi di stringhe, checksum e risorse;
- esame mirato di JAR e classi;
- decompilazione limitata alle parti indispensabili;
- costruzione autonoma di parser e writer.

Se l'obiettivo richiede attività oltre il perimetro strettamente necessario all'interoperabilità, il lavoro si arresta e si apre la decisione legale pertinente in «Decisioni condizionate dagli spike» prima di procedere.

## 23.4 Corpus

Corpus misto:

- 5–10 pratiche storiche complete;
- dichiarazioni iniziali e, se disponibili, sostitutive di tipo 1, 2 e 3 e ulteriori dichiarazioni che si affiancano alla precedente;
- legittime e testamentarie;
- immobili, rapporti, passività e allegati vari;
- DIZ, telematico, stampa e documenti originari;
- pratiche sintetiche con una sola modifica per volta;
- hash e inventario di ogni campione.

Una coppia prodotta su macOS e Windows può essere aggiunta a sviluppo concluso come evidenza facoltativa. La sua assenza non riduce la qualificazione del corpus e non blocca `TG-DIZ`.

I campioni reali restano fuori da Git. Nel repository entrano solo fixture sintetiche non riconducibili ai clienti.

## 23.5 Preservazione trasparente

Elementi non compresi:

- vengono conservati nella forma originale;
- mantengono posizione e versione;
- vengono reinseriti invariati quando possibile;
- bloccano soltanto trasformazioni rischiose;
- producono un avviso quando il round-trip non è garantibile.

## 23.6 Fallback

Se la generazione affidabile non è possibile, si apre un ADR per un componente minimo:

- Java, se il formato è nativamente Java;
- altro componente locale solo se tecnicamente dimostrato;
- nessuna riscrittura dell'intera app desktop;
- web app, server e dati restano canonici.

## 23.7 Compatibilità Windows facoltativa

La qualificazione DIZ usa SuccessioniOnLine su macOS e verifica deterministicamente che parser, writer, allegati e riferimenti ai file non dipendano dal sistema operativo. Il writer non emette percorsi assoluti locali e normalizza soltanto gli elementi per i quali il formato osservato dimostra una rappresentazione canonica.

Dopo il completamento dello sviluppo, se è disponibile senza introdurre costi o infrastruttura permanente, lo stesso flusso può essere ripetuto con SuccessioniOnLine su Windows. Questa prova:

- è best-effort e advisory;
- non richiede una VM o un PC dedicato;
- se non è disponibile, non viene eseguita o fallisce per ragioni esclusivamente ambientali, non blocca alcun Technical Gate, fase di implementazione o release stabile;
- registra le osservazioni non riconducibili al formato come compatibilità advisory da valutare separatamente;
- non rende advisory un difetto del formato: una divergenza DIZ riproducibile e confermata blocca l'output interessato finché non viene risolta o esclusa dal perimetro dichiarato;
- non modifica il supporto obbligatorio della web app su Chrome ed Edge per Windows.

---

# 24. Round-trip con SuccessioniOnLine

## 24.1 Flusso

1. Sequent registra revisione, source bundle e ruleset esportati;
2. valida internamente campi, quadri, XSD e allegati;
3. verifica che la fornitura rappresenti una sola dichiarazione e non superi 40 MB compressi;
4. genera DIZ e pacchetto allegati conformi;
5. l'utente apre e modifica in SuccessioniOnLine;
6. esegue il controllo obbligatorio con il software Agenzia/Sogei;
7. salva il DIZ e produce il telematico soltanto dopo esito compatibile;
8. reimporta in Sequent DIZ, diagnostici e file prodotti;
9. Sequent esegue confronto a tre vie;
10. importa modifiche compatibili e chiede sui conflitti;
11. registra nuova revisione;
12. importa stampa, ricevute, esiti e quietanze.

Il validator interno riduce gli errori ma non sostituisce il controllo ufficiale, che le specifiche rendono necessario prima della trasmissione.

## 24.2 Confronto a tre vie

- base: revisione esportata;
- lato A: stato corrente Sequent;
- lato B: DIZ salvato dal programma ufficiale.

Le modifiche non conflittuali vengono unite. Nessuna delle due copie prevale globalmente.

## 24.3 Stati ufficiali

- Pronta per preflight ufficiale;
- Validata internamente;
- Pronta per controllo;
- Esportata in DIZ;
- Controllata in SuccessioniOnLine;
- DIZ reimportato;
- Telematico generato;
- Presentata;
- Esito acquisito;
- Chiusa.

L'esportazione non equivale a controllo o presentazione.

## 24.4 Ricevute, presentazione e volture

Sequent distingue sempre:

1. **prima ricevuta:** attesta la trasmissione del file;
2. **seconda ricevuta:** riporta esito dei controlli formali ed estremi di registrazione; se positiva costituisce prova della presentazione e registrazione;
3. **terza ricevuta:** esito del pagamento/addebito, quando applicabile;
4. **copia semplice/regolarità:** resa disponibile dopo i controlli dell’ufficio e distinta dall’attestazione di avvenuta presentazione;
5. **esito volture:** totale, parziale o negativo, quando è stata richiesta la voltura automatica.

Lo stato `Presentata` non deriva dal DIZ, dal telematico, dal controllo locale o dalla prima ricevuta. Richiede seconda ricevuta positiva oppure, solo se il file non è disponibile, conferma manuale motivata con estremi ufficiali.

Quando la voltura automatica non è richiesta o non è possibile — inclusi casi tavolari/Libro fondiario, oneri reali, eredità giacente o amministrata e trust secondo la baseline — Sequent apre un adempimento distinto con termine di 30 giorni dalla registrazione risultante nella seconda ricevuta. Non marca mai una voltura come completata senza il relativo esito.

## 24.5 Fascicolo conclusivo

Sequent importa e riconosce:

- DIZ definitivo;
- telematico;
- stampa;
- report di conformità interno;
- diagnostici/esito del controllo ufficiale;
- ricevute;
- quietanze;
- documenti volture;
- invii successivi.

Ogni invio è un evento distinto e non sovrascrive i precedenti.

---

# 25. Ciclo di vita e stati della pratica

## 25.1 Stati principali

```text
Bozza
→ Raccolta documenti
→ Elaborazione
→ Da verificare
→ Devoluzione da confermare
→ Preflight Sequent superato
→ Esportata in DIZ
→ Modificata in SuccessioniOnLine
→ Reimportata
→ Telematico generato
→ Controllo ufficiale superato
→ Trasmessa
→ Presentata e registrata
→ Volture in lavorazione/completate, se applicabili
→ Chiusa
```

Stati separati:

- Archiviata;
- Cestino;
- Annullata.

## 25.2 Derivazione e override

Lo stato deriva dagli eventi osservati, ma l'utente può correggerlo. Ogni override è auditato. `Presentata e registrata` richiede la seconda ricevuta positiva oppure, solo quando non è ottenibile, una conferma manuale motivata con gli estremi ufficiali. Il solo export, il telematico, il controllo o la prima ricevuta non bastano.

## 25.3 Stato dei job

OCR, Codex, conversioni, import e DIZ hanno stati propri e non devono rendere ambiguo lo stato generale della pratica.

## 25.4 Controlli per severità

| Severità         | Effetto                                     |
| ---------------- | ------------------------------------------- |
| **Bloccante**    | impedisce la prontezza e normalmente il DIZ |
| **Avviso**       | non blocca, ma compare nel riepilogo        |
| **Informazione** | suggerimento o controllo facoltativo        |

Esempi bloccanti:

- dato obbligatorio mancante;
- codice fiscale invalido;
- quote incoerenti;
- quadro non rappresentabile;
- allegato obbligatorio assente;
- differenza critica non riconciliata;
- versione DIZ non qualificata.

Una deroga è possibile soltanto quando tecnicamente consentita, con motivazione e nuova verifica.

---

# 26. Anagrafiche e beni riutilizzabili

## 26.1 Anagrafiche globali

Sequent può riconoscere e proporre:

- persone;
- enti;
- documenti di identità;
- recapiti;
- relazioni;
- immobili;
- beni o rapporti già presenti.

## 26.2 Snapshot per pratica

Ogni dichiarazione conserva una copia immutabile dei dati usati. Modificare l'anagrafica globale non riscrive la storia.

Per una pratica aperta, Sequent mostra le differenze e consente l'aggiornamento esplicito.

## 26.3 Unione identità

Omonimi, codici fiscali discordanti e identificativi incompleti non vengono uniti automaticamente. Il merge richiede confronto e conferma.

---

# 27. Scadenze essenziali e metadati operativi

## 27.1 Scadenze

Il perimetro iniziale gestisce le scadenze essenziali descritte nel Fascicolo 1:

- termine ordinario di dodici mesi dalla data del decesso;
- decorrenze alternative previste per nomina di rappresentanti/curatori/trustee/esecutori, liquidazione giudiziale, possesso temporaneo, morte presunta, beneficio d'inventario, rinuncia, eventi sopravvenuti ed enti in attesa di riconoscimento;
- termine della dichiarazione sostitutiva quando decorre da una sopravvenienza;
- termine di 30 giorni dalla registrazione per la domanda di voltura nei casi senza voltura automatica;
- ulteriori termini espressamente presenti nel source bundle, incluse condizioni temporali di agevolazioni e documenti.

Ogni scadenza registra fonte, evento iniziale, data calcolata, eventuale override motivato e stato. Attività libere, agenda generale e promemoria complessi restano rinviati.

## 27.2 Metadati di studio

- cliente o referente;
- recapiti;
- codice interno facoltativo;
- data di apertura;
- note interne;
- professionista o ufficio esterno coinvolto;
- origine della pratica;
- stato dell'incarico e della raccolta documentale.

Sono esclusi compensi, parcelle, timesheet, fatturazione e CRM generale.

---

# 28. Ricerca globale

## 28.1 Perimetro

Ricerca full-text deterministica su:

- defunto;
- eredi e soggetti;
- codice fiscale;
- dati catastali;
- banche e rapporti;
- nomi file e metadati;
- testo OCR;
- note;
- DIZ e importazioni;
- dati strutturati;
- audit selezionato quando utile.

## 28.2 Filtri

- stato;
- anno;
- tipo dichiarazione;
- categoria documento;
- presenza di errori;
- procedimento o dichiarazione;
- soggetto o bene.

## 28.3 Implementazione

SQLite FTS5 è il default. Il risultato deve spiegare il match e aprire il contesto corretto.

La ricerca semantica è rinviata: con poche pratiche non giustifica indici vettoriali o costi AI.

---

# 29. Salvataggio, revisioni e storico

## 29.1 Autosave

Ogni modifica viene salvata localmente quasi subito e sincronizzata quando possibile. Le modifiche ravvicinate vengono aggregate; non nasce una revisione per ogni carattere.

## 29.2 Snapshot

Snapshot completi soltanto:

- prima di importare o reimportare un DIZ;
- prima di un ripristino completo;
- al momento della presentazione e della chiusura;
- quando l'utente crea manualmente una versione nominata.

Le run Codex e le modifiche ordinarie producono cronologia e diff, non snapshot completi automatici.

## 29.3 Audit essenziale

L'audit applicativo conserva gli eventi che servono a ricostruire il fascicolo:

- caricamento, sostituzione e classificazione dei documenti;
- correzioni manuali rilevanti e fonte autorevole scelta;
- conferma della devoluzione;
- deroghe ai controlli;
- DIZ generati e reimportati;
- differenze introdotte da SuccessioniOnLine;
- telematici, ricevute, riapertura ed eliminazione.

Login, sessioni, passkey, job OCR, retry, backup e normali sincronizzazioni restano nei log tecnici, non nell'audit della pratica. Gli eventi precedenti non vengono riscritti dall'interfaccia.

---

# 30. Chiusura, archiviazione e cancellazione

## 30.1 Chiusura

Una pratica chiusa è in sola lettura. `Riapri pratica` richiede:

- motivazione;
- nuova revisione;
- eventuale nuova dichiarazione successiva;
- preservazione immutabile di DIZ, telematici e ricevute precedenti.

## 30.2 Archiviazione

Archiviare nasconde la pratica dalle viste operative senza alterare i dati.

## 30.3 Cestino

Il ciclo è:

```text
Attiva → Archiviata → Cestino → Eliminata definitivamente
```

Il cestino conserva per 30 giorni e consente ripristino.

## 30.4 Eliminazione definitiva

Richiede:

- nuova verifica con password o passkey;
- conferma testuale;
- riepilogo dei dati;
- proposta di esportazione della pratica;
- audit dell'operazione.

Le copie offline vengono eliminate quando i dispositivi tornano online. Un dispositivo completamente offline conserva inevitabilmente la copia fino alla sincronizzazione.

L'audit residuo non deve conservare i documenti o i dati personali eliminati.

---

# 31. Offline: obiettivi e perimetro

## 31.1 Modello

La VPS è la fonte primaria. L'utente può rendere offline soltanto le pratiche selezionate; non esiste una replica modificabile automatica dell'intero archivio nel browser.

Il download completo dell'archivio è il backup definito in «Backup e ripristino», non una funzione di sincronizzazione offline.

## 31.2 Funzioni garantite offline

Per una pratica già scaricata:

- apertura e consultazione;
- visualizzazione dei documenti disponibili;
- modifica dei campi e delle note;
- inserimento manuale;
- nuovi allegati in coda;
- calcoli e controlli semplici eseguibili nel browser;
- salvataggio locale delle modifiche in attesa di sincronizzazione.

## 31.3 Funzioni online-only

- Codex e ricerca normativa;
- OCR e conversioni server-side;
- ricerca globale sull'intero archivio;
- cronologia e audit completi;
- devoluzione avanzata e calcoli che richiedono regole non presenti localmente;
- generazione documenti e pacchetti finali;
- importazione/generazione/reimportazione DIZ;
- risoluzione di conflitti articolati;
- backup, aggiornamenti e monitoraggio ufficiale.

## 31.4 Storage browser

- IndexedDB tramite `idb`;
- documenti come Blob;
- service worker SvelteKit;
- richiesta di storage persistente quando supportata;
- preflight dello spazio per la pratica selezionata;
- stato di completezza locale.

La copia offline non è un backup e può essere rimossa dal browser o dall'utente. Sequent non cancella automaticamente modifiche non sincronizzate per liberare spazio.

---

# 32. Sincronizzazione e conflitti offline

## 32.1 Sincronizzazione ordinaria

Ogni modifica offline parte da una revisione server nota. Se la revisione server non è cambiata, la sincronizzazione è automatica.

Se la pratica è cambiata anche sul server, Sequent non costruisce un merge universale campo-per-campo. Offre due scelte sicure:

1. mantenere la versione server;
2. salvare la versione locale come copia separata da confrontare e importare manualmente.

Il confronto a tre vie resta obbligatorio soltanto per il flusso definito in «Round-trip con SuccessioniOnLine».

## 32.2 Nessun blocco preventivo

Non esiste checkout o lock visibile. Essendo single-user, la modifica simultanea della stessa pratica su più dispositivi è considerata eccezionale e viene gestita con la copia di confronto.

## 32.3 Aggiornamento schema offline

Prima di aggiornare la cache, Sequent tenta di sincronizzare le modifiche locali. Se una migrazione non è sicura, la pratica resta in sola lettura e l'utente può esportare i dati locali prima di riscaricarla.

## 32.4 Disaster recovery

Se la VPS viene ripristinata da un backup più vecchio e il browser contiene modifiche più recenti, il browser non sovrascrive il server. Offre `Esporta modifiche locali non sincronizzate`, producendo un pacchetto JSON/ZIP da reimportare manualmente dopo il ripristino.

Non esistono branch applicativi o merge automatici di disaster recovery.

---

# 33. Browser e mobile

## 33.1 Nessuna installazione PWA

Sequent funziona in normali schede del browser. Non mostra inviti di installazione, non usa App Store e non richiede modalità standalone.

Service worker e offline selettivo restano disponibili senza installazione.

## 33.2 Matrice supportata

| Sistema     | Browser | Livello                    |
| ----------- | ------- | -------------------------- |
| macOS       | Safari  | completo                   |
| macOS       | Chrome  | completo                   |
| Windows     | Chrome  | completo                   |
| Windows     | Edge    | completo                   |
| iPhone/iPad | Safari  | operazioni mobili previste |

## 33.3 Mobile

Da iPhone/iPad:

- consultazione completa;
- caricamento da Fotocamera e File;
- creazione pratica;
- correzione campi semplici;
- conferma/rifiuto singole proposte;
- attività e controlli;
- avvio OCR o Codex;
- stato job.

Le attività complesse restano accessibili ma desktop-optimized.

## 33.4 Notifiche

Solo notifiche interne:

- badge Dashboard;
- centro attività;
- stato job;
- conflitti;
- backup vecchio;
- aggiornamenti ufficiali.

Niente e-mail o notifiche push/browser per le pratiche.

---

# 34. Autenticazione e sessioni

## 34.1 Account proprietario

- un solo account;
- username univoco nell’istanza, conservato nella forma visualizzata e confrontato senza distinzione tra maiuscole e minuscole;
- nessuna registrazione pubblica, invito o ruolo;
- creazione al primo avvio tramite comando amministrativo locale; il setup web resta disponibile soltanto nello sviluppo non esposto;
- reset d'emergenza tramite comando sulla VPS.

## 34.2 Metodi di accesso

- username e password come metodo universale;
- password da 8 a 128 caratteri, senza requisiti di composizione;
- passkey facoltativa per comodità;
- nessun magic link, TOTP, recovery code o dipendenza dall'e-mail.

## 34.3 Sessioni

- cookie `Secure`, `HttpOnly` e `SameSite`;
- token opachi ad alta entropia conservati server-side come hash;
- durata massima 12 mesi con rinnovo durante l'uso;
- rotazione dopo login, cambio password e reset;
- protezione CSRF per le mutazioni;
- pulsante `Disconnetti tutti gli altri dispositivi`;
- nessuna pagina complessa di gestione sessioni per dispositivo.

## 34.4 Offline autorizzato

Un browser già autenticato continua ad aprire le pratiche offline. Logout elimina la copia offline locale. Una revoca remota diventa effettiva quando il dispositivo torna online.

## 34.5 Reautenticazione

Nuova password o passkey soltanto per:

- eliminazione definitiva;
- modifica di password o passkey;
- reset delle impostazioni di sicurezza.

Backup, diagnostica e normali operazioni amministrative non richiedono una seconda verifica. Il restore completo avviene da CLI con accesso amministrativo alla VPS e non usa la sessione web.

## 34.6 Difesa login

- rate limiting per IP/account;
- ritardi progressivi dopo errori;
- una verifica Argon2 uniforme per ogni tentativo non già bloccato, anche quando lo username non coincide;
- messaggi che non rivelano dettagli inutili;
- registrazione tecnica di successi e fallimenti;
- nessun CAPTCHA o Turnstile.

## 34.7 Passkey e hostname

Il cambio di hostname/RP ID può rendere non valide le passkey esistenti. La password e il reset amministrativo garantiscono sempre il recupero; su un nuovo hostname si registra una nuova passkey.

## 34.8 Onboarding

1. scelta del nome utente;
2. scelta password;
3. passkey facoltativa;
4. verifica Codex e strumenti documentali;
5. controllo storage e primo backup consigliato.

---

# 35. Sicurezza, privacy e protezione dati

## 35.1 Modello proporzionato

Sequent è privata, single-user e usa dispositivi personali. Non adotta cifratura applicativa campo-per-campo né cifratura separata della cache browser.

Restano obbligatori:

- HTTPS;
- firewall e sole porte necessarie;
- SSH con chiave tramite canale amministrativo/Tailscale;
- utente, container, volumi e segreti separati da Hub Fatture;
- database e documenti non esposti direttamente in rete;
- cookie sicuri e password hashing robusto;
- segreti fuori da Git e dai log.

## 35.2 Codex

Codex è autorizzato a trattare l'intera pratica. La protezione deriva dal workspace senza segreti, dalla sandbox standard e dalla separazione fra analisi offline e ricerca normativa online. Non viene costruita un'infrastruttura proprietaria di data-loss prevention.

## 35.3 File caricati

Ogni file può essere conservato. Sono elaborati soltanto i formati riconosciuti. Macro, script e contenuti attivi non vengono eseguiti; gli archivi sono protetti almeno da path traversal ed espansioni manifestamente anomale. Gli originali restano immutabili.

## 35.4 Repository pubblico

Dati reali, DIZ, OCR, diagnostica, backup e fixture dei clienti restano fuori da Git, CI e artifact. Sulla VPS possono essere usati soltanto nei volumi `data/`, `private/` o `tmp/`, mai nel checkout versionato.

---

# 36. Logging e diagnostica

## 36.1 Log tecnici ordinari

Sempre attivi e conservati indicativamente per 30 giorni:

- request/job ID;
- tipo di operazione;
- durata ed esito;
- codice errore;
- eventi di login e sessione necessari al troubleshooting;
- nessuna copia integrale automatica dei documenti.

## 36.2 Diagnostica completa opt-in

Attivabile per una pratica o un job specifico. Può includere prompt, risposta Codex, testo OCR, comandi e file intermedi necessari a riprodurre il problema.

- eliminazione automatica dopo 30 giorni;
- possibilità di conservarla manualmente per un bug concreto;
- consultazione e download dall'app senza reautenticazione aggiuntiva;
- esclusa per impostazione predefinita da backup ed esportazione della pratica;
- il risultato strutturato finale, modello e versione delle istruzioni restano comunque conservati.

---

# 37. Backup e ripristino

## 37.1 Backup completo manuale

Un pulsante genera un archivio completo non cifrato. Per ottenere coerenza in un'app single-user è sufficiente una breve modalità manutenzione:

1. interrompere temporaneamente nuove mutazioni;
2. attendere o sospendere il job pesante corrente;
3. creare uno snapshot SQLite tramite Online Backup API o equivalente;
4. copiare la cartella documenti e gli artefatti non rigenerabili;
5. produrre manifest, checksum e ZIP;
6. riaprire l'app.

Il backup include pratiche, documenti, revisioni rilevanti, DIZ, telematici, ricevute e configurazione non segreta. Non include password hash, passkey, sessioni, recovery code, segreti o sessione Codex. Dopo un disaster recovery l'unico account viene ricreato con il comando amministrativo previsto dal runbook.

## 37.2 Promemoria

- avviso non bloccante dopo 7 giorni;
- più evidente dopo 14 giorni;
- avviso prima di aggiornamenti o operazioni distruttive.

## 37.3 Snapshot tecnici

Prima di aggiornamenti, migrazioni e restore vengono conservati sulla VPS gli ultimi tre snapshot tecnici, destinati esclusivamente al rollback.

## 37.4 Esportazione singola pratica

Formato proprietario versionato e reimportabile, con manifest, checksum, documenti e stato della pratica. Resta distinta dal backup dell'intera installazione.

## 37.5 Ripristino

Il disaster recovery completo non ha una UI dedicata. Si esegue dal runbook con un comando amministrativo, per esempio:

```bash
docker compose run --rm sequent restore /backup/sequent-backup.zip
```

Il comando limita preventivamente numero di entry, dimensione espansa, rapporto di compressione e spazio disponibile, estrae sequenzialmente contando i byte effettivi, verifica manifest e checksum, ripristina database/documenti e richiede il nuovo bootstrap dell'account. La web app continua a supportare l'importazione di una singola pratica.

## 37.6 Copie temporanee per test rischiosi

Non esiste un trasferimento fra ambienti permanenti. Quando una modifica riguarda migrazioni SQLite, import/export DIZ, backup/restore, trasformazioni documentali o altre operazioni potenzialmente distruttive, l'istanza crea una copia coerente e temporanea dei dati necessari in `tmp/` oppure in un volume Docker usa-e-getta.

La copia:

- non monta in scrittura l'archivio operativo;
- non sincronizza automaticamente modifiche verso i dati reali;
- può contenere una singola pratica oppure una copia coerente dell'archivio, secondo il test;
- viene identificata chiaramente come non operativa;
- viene cancellata al termine della prova, salvo conservazione esplicita per un bug riproducibile.

Per le prove ordinarie bastano fixture sintetiche e il corpus privato. I risultati di una prova temporanea tornano nell'applicazione soltanto tramite codice, migrazione o import deliberato già revisionato.

---

# 38. Architettura tecnica

## 38.1 Forma del prodotto

- web app pura e responsive;
- SvelteKit come frontend e backend;
- una sola codebase TypeScript;
- un solo container/processo applicativo nel perimetro iniziale;
- nessuna app desktop o nativa;
- eventuale componente locale soltanto come fallback DIZ dimostrato necessario.

## 38.2 Stack applicativo

- Svelte e SvelteKit sulla linea qualificata dai manifest eseguibili;
- Node.js sulla linea qualificata dai manifest eseguibili;
- TypeScript con compatibility layer finché richiesto dal tooling;
- SQLite;
- filesystem content-addressed;
- Zod;
- IndexedDB tramite `idb`;
- PDF.js;
- Codex SDK;
- strumenti documentali invocati come processi figli.

## 38.3 Monolite modulare

```text
src/
├── routes/
├── lib/
│   ├── domain/
│   ├── documents/
│   ├── diz/
│   ├── codex/
│   ├── calculations/
│   ├── offline/
│   └── server/
└── service-worker/
```

I moduli hanno confini chiari e test, ma non diventano microservizi.

## 38.4 Processo unico e lavori pesanti

Il processo SvelteKit gestisce web, API e coda persistente. OCRmyPDF, Tesseract, ImageMagick, LibreOffice e Codex vengono avviati come processi figli con timeout e limiti di risorse. Un solo lavoro pesante viene eseguito alla volta.

Se il processo applicativo si riavvia, i job `running` vengono marcati come interrotti e ripresi o ritentati in modo idempotente. La separazione in un worker dedicato resta una futura ottimizzazione basata su misure, non una fondazione del perimetro iniziale.

## 38.5 Browser-first

Il browser riceve soltanto ciò che serve alla pratica aperta. Funzioni server-only non vengono replicate artificialmente in WebAssembly o nel service worker.

---

# 39. Modello dati e persistenza

## 39.1 Modello canonico semplice

Lo stato completo di ogni dichiarazione è un documento JSON validato e versionato. SQLite governa elenco pratiche, documenti, job, sessioni, ricerca, audit essenziale e anagrafiche/beni condivisi definiti in «Anagrafiche e beni riutilizzabili».

Nel perimetro iniziale non viene creata una proiezione relazionale completa di ogni campo ministeriale.

Tabelle iniziali indicative:

```text
owner
sessions
practices
declarations
shared_subjects
shared_assets
documents
jobs
audit_events
practice_search
```

## 39.2 JSON della dichiarazione

Contiene almeno:

- versione schema e modello ufficiale;
- `officialSourceBundleId`, versione del catalogo e ruleset usato;
- defunto e dichiarazione;
- beneficiari e relazioni;
- beni, passività, donazioni, agevolazioni e volture;
- devoluzione e calcoli;
- checklist e allegati;
- fonti, affidabilità, decisioni e controlli;
- riferimenti agli artefatti DIZ e ufficiali.

La provenienza dei singoli campi può essere incorporata nel JSON anziché duplicata in una tabella `facts` universale.

## 39.3 Revisioni

- stato corrente aggiornato tramite autosave;
- diff e cronologia per le modifiche ordinarie;
- snapshot completi soltanto nei casi definiti in «Salvataggio, revisioni e storico»;
- snapshot immutabile della dichiarazione presentata.

## 39.4 Documenti su filesystem

Gli originali e i derivati vivono in un content-addressed store per SHA-256. Scrittura minima sicura:

1. file temporaneo sullo stesso filesystem;
2. flush/hash;
3. collegamento atomico nel content-addressed store senza sovrascrivere un blob già presente;
4. transazione breve che collega il blob al documento;
5. pulizia periodica degli orfani dopo un grace period.

Non serve un Technical Gate separato: integrità, crash e restore sono test ordinari della persistenza.

## 39.5 SQLite

- filesystem locale della VPS;
- WAL e `busy_timeout`;
- foreign key abilitate;
- versione runtime sicura verificata in CI/health;
- un solo processo applicativo scrive il database;
- nessuna transazione resta aperta durante OCR o Codex;
- `better-sqlite3` iniziale;
- niente ORM.

PostgreSQL viene valutato soltanto se misure reali mostrano un limite non gestibile di SQLite.

---

# 40. Coda lavori e processi server

## 40.1 Coda persistente

La tabella `jobs` conserva:

- tipo;
- pratica/documento;
- input hash e parametri;
- stato;
- avanzamento;
- tentativi;
- errore finale;
- timestamp.

Stati minimi:

```text
queued → running → completed | failed | cancelled
```

## 40.2 Esecuzione

Il processo applicativo seleziona un solo job pesante alla volta e avvia il relativo comando come processo figlio. Attività leggere possono essere eseguite in parallelo se non competono per risorse significative.

Non servono lease, heartbeat o coordinamento multiprocesso. All'avvio, i job rimasti `running` vengono marcati `interrupted` e ricondotti a coda o verifica manuale secondo l'idempotenza del tipo di lavoro.

## 40.3 Idempotenza e retry

- chiave di idempotenza per operazioni ripetibili;
- retry automatico soltanto per errori transitori;
- retry manuale per errori documentali, Codex e DIZ;
- annullamento quando il processo figlio è interrompibile;
- doppio clic non crea due job equivalenti.

## 40.4 UI

La UI mostra fase, avanzamento, errore, annullamento e retry. Chiudere il browser non interrompe il job server.

---

# 41. Toolchain e dipendenze

## 41.1 Policy

- latest stable compatibile;
- versioni esatte;
- lockfile obbligatorio;
- nessun tag Docker `latest`;
- aggiornamento via PR;
- prerelease vietate salvo Oxfmt approvato;
- dipendenze minime;
- nessuna duplicazione di responsabilità.

## 41.2 Runtime applicativo

| Componente       | Decisione                                                       |
| ---------------- | --------------------------------------------------------------- |
| Node             | linea stabile qualificata e pin esatto nei manifest eseguibili  |
| TypeScript       | compilatore principale qualificato dalla toolchain              |
| Compatibility TS | versione richiesta dal tooling Svelte; rimozione solo dopo gate |
| Svelte           | linea stabile corrente                                          |
| SvelteKit        | linea stabile corrente                                          |
| Adapter          | adapter-node                                                    |
| Package manager  | npm, versione esatta                                            |

Le versioni selezionate di Node e TypeScript richiedono il gate `TG-TOOLCHAIN`; l'approvazione non autorizza a ignorare incompatibilità osservate. Deve restare disponibile una toolchain di rollback qualificata finché la linea corrente non è stabilizzata. Il check Svelte compatibile con il tooling è autorevole; `--tsgo` resta una verifica aggiuntiva finché l'integrazione non è pienamente supportata.

## 41.3 Dipendenze runtime previste

- `@sveltejs/kit`;
- `@sveltejs/adapter-node`;
- `svelte`;
- `zod`;
- `better-sqlite3`;
- `idb`;
- `pdfjs-dist`;
- `fast-xml-parser`;
- `@openai/codex-sdk`;
- dipendenza minima per password hashing Argon2id;
- dipendenza WebAuthn mantenuta, se la Web API nativa non basta a un'implementazione robusta;
- librerie DOCX/XLSX/PDF solo dopo spike e con responsabilità non sovrapposte.

L'elenco definitivo nasce dallo scaffolding; `package.json`, lockfile, Dockerfile e CI sono le fonti canoniche dei pin e non vanno duplicati in un contratto separato.

## 41.4 Strumenti di sistema

- Codex CLI;
- Tesseract e dati lingua italiana;
- Poppler;
- OCRmyPDF;
- ImageMagick con HEIC/TIFF;
- LibreOffice headless;
- qpdf o dipendenze richieste da OCRmyPDF;
- `xmllint`;
- utility di ispezione DIZ: `file`, `xxd`, `strings`, `unzip`;
- Java soltanto se il gate DIZ lo richiede.

## 41.5 Qualità del codice

- Oxfmt come unico formatter diretto;
- Oxlint come unico linter diretto;
- `oxlint-tsgolint` o equivalente per type-aware lint;
- `svelte-check` con il compatibility layer richiesto come controllo autorevole iniziale;
- `svelte-check --tsgo` come controllo aggiuntivo quando compatibile;
- Vitest;
- Playwright.

### 41.5.1 Svelte Doctor

`svelte-doctor` viene introdotto insieme allo scaffolding SvelteKit come required check bloccante. La versione è esatta nel lockfile; la CI esegue soltanto scansioni in lettura e non abilita fix automatici, migrazioni, hook Git o funzioni AI. `svelte-check` resta il controllo autorevole per compilazione e diagnostica Svelte, mentre Svelte Doctor è un gate complementare di qualità.

I finding di Svelte Doctor seguono questa policy:

- ogni finding non soppresso rende rosso il check `svelte-doctor` e blocca il merge, indipendentemente dalla categoria; metriche e punteggio privi di finding non bloccano;
- non ricevono automaticamente priorità esterne e non producono modifiche automatiche;
- un finding reale viene corretto prima del merge, con una regressione mirata quando riguarda sicurezza, correttezza, perdita dati o comportamento osservabile;
- un falso positivo può essere soppresso soltanto con eccezione minima, motivazione versionata e review nella stessa PR; non sono ammessi bypass temporanei, `continue-on-error`, riduzioni globali delle soglie o baseline che nascondano finding nuovi o esistenti;
- errori operativi, crash o output non interpretabili del tool mantengono il check rosso e richiedono diagnosi o retry, non un bypass;
- l'attivazione iniziale richiede il triage completo e zero finding non soppressi prima di aggiungere `svelte-doctor` alla ruleset.

## 41.6 Esclusioni confermate

Non installare inizialmente:

- Prettier;
- ESLint;
- Tailwind;
- component library generalista;
- Redux/Zustand;
- React Hook Form/Superforms salvo prova di necessità;
- Axios;
- Prisma/Drizzle/Sequelize;
- PostgreSQL;
- Redis/BullMQ;
- OPFS;
- Python applicativo;
- Rust o Go;
- Workbox se il service worker SvelteKit è sufficiente.

## 41.7 Oxfmt

L'adozione di Oxfmt è consapevole nonostante lo stato beta. Vincoli obbligatori:

- usare esclusivamente il pacchetto npm `oxfmt`, non il binario standalone;
- abilitare esplicitamente il supporto `svelte` nella configurazione;
- mantenere `svelte` disponibile come dipendenza richiesta dal formatter;
- includere golden file `.svelte` nel format gate che coprano markup, blocchi `<script>`, `<style>`, commenti, direttive e casi multilinea;
- trattare ogni aggiornamento Oxfmt come dipendenza critica con approvazione deliberata, anche se classificato patch o minor;
- documentare che la formattazione Svelte è attualmente Prettier-backed internamente a Oxfmt, pur senza installare Prettier come dipendenza diretta;
- non affiancare Prettier per gli stessi file;
- se un bug blocca la toolchain, aprire un Decision Gate anziché mantenere due formatter permanenti senza approvazione.

## 41.8 Oxlint ed ESLint

Oxlint non copre universalmente ogni regola template Svelte, ma la combinazione Oxlint + svelte-check + test è approvata per il perimetro iniziale. ESLint entra solo se una regola concreta e importante non è coperta.

---

# 42. Formati e limiti di caricamento

## 42.1 Formati elaborabili

- PDF nativi e scansioni;
- JPG/JPEG;
- PNG;
- HEIC;
- TIFF;
- WebP;
- XML;
- XLSX/XLS;
- CSV;
- ODS;
- DOCX/DOC;
- ODT;
- RTF;
- TXT;
- ZIP;
- DIZ;
- telematici;
- file firmati o contenitori riconosciuti.

File diversi vengono conservati come `Non elaborabile automaticamente`. I formati accettati come input non coincidono con i formati ammessi come allegati telematici finali.

## 42.2 Limiti iniziali

- 250 MB per singolo file;
- 2 GB per singolo caricamento o ZIP espanso;
- limite configurabile di pagine;
- controllo spazio disco;
- upload a blocchi riprendibile;
- timeout conversioni;
- limiti CPU e memoria.

Un file oltre soglia resta sul dispositivo e l'utente può modificare il limite avanzato o ridurre il file. Non viene perso silenziosamente.

## 42.3 Sicurezza archivi

- niente path assoluti o `..`;
- limite numero file;
- limite rapporto compressione;
- stop su espansione anomala;
- preservazione dell'archivio originale.

## 42.4 Limiti del pacchetto ufficiale

Per DIZ/telematico e allegati finali prevalgono i limiti di `SRC-08`, documentati in `SRC-07` e aggiornati da `SRC-09`:

- una fornitura contiene i dati di una sola dichiarazione;
- XML 1.0, codifica UTF-8 e struttura SUC13/XSD applicabile;
- massimo 40 MB complessivi compressi;
- massimo 5 MB per ogni allegato;
- allegati esclusivamente TIF/TIFF conforme oppure PDF/A-1a/PDF/A-1b;
- pacchetto oltre 40 MB: export telematico bloccato e indicazione del percorso presso l'ufficio territoriale;
- allegato oltre 5 MB: split/conversione obbligatori prima dello stato `Pronta`;
- nessun limite configurabile dell'app può derogare ai limiti ministeriali finali.

---

# 43. Infrastruttura VPS e istanza unica

## 43.1 Principio

Sequent usa **una sola istanza permanente** sulla VPS OCI. Non esistono ambienti Development, Staging e Production separati, perché owner, sviluppatore e utilizzatore coincidono e sono accettabili brevi finestre di manutenzione.

La separazione necessaria è fra:

- **checkout di lavoro**, dove Codex modifica e testa il codice;
- **runtime attivo**, che esegue soltanto una release approvata;
- **dati operativi**, che non vengono montati liberamente nel checkout;
- **copie temporanee**, create soltanto per test rischiosi.

Un'unica istanza non autorizza l'esecuzione diretta di codice non committato sui dati reali.

## 43.2 Host

VPS OCI esistente:

- regione Milano;
- Ampere A1 ARM64, 4 OCPU e 24 GB RAM;
- boot volume circa 47 GB;
- Ubuntu 24.04 LTS;
- Docker, Docker Compose e Caddy.

La configurazione effettiva viene verificata durante il preflight. Hub Fatture resta prioritario in caso di contesa delle risorse.

## 43.3 Layout canonico

```text
/opt/sequent/
├── repo/          # checkout Git su cui lavora Codex
├── runtime/       # Compose, configurazione e puntatore alla release attiva
├── data/          # SQLite e archivio documentale operativo
├── private/       # corpus reale, dati operativi e segreti, sempre fuori da Git
├── releases/      # immagini/digest o build già approvati
├── snapshots/     # ultimi snapshot tecnici di rollback
└── tmp/           # copie e volumi usa-e-getta per test rischiosi
```

I permessi devono impedire al processo di build/test ordinario di modificare accidentalmente `data/`. L'accesso applicativo ai dati reali avviene tramite il runtime o comandi amministrativi espliciti, non tramite script arbitrari eseguiti dal checkout.

## 43.4 Hostname e accesso

- un solo hostname Dynu gratuito dedicato;
- HTTPS pubblico per l'uso ordinario quando l'istanza entra in esercizio;
- Tailscale/VPN e chiave SSH per sviluppo e amministrazione;
- nessun pannello amministrativo pubblico;
- virtual host Caddy separato da Hub Fatture.

Prima dell'attivazione autorizzata il servizio può rimanere non pubblicato e raggiungibile soltanto tramite canale amministrativo. L'esposizione personale tramite hostname dedicato, Caddy e HTTPS viene attivata insieme alle procedure operative; la validazione finale e il go-live usano poi lo stesso endpoint già qualificato, senza duplicazione dei dati o promozione fra ambienti.

## 43.5 Runtime e deployment

Docker Compose dedicato con:

- un servizio applicativo `sequent`;
- volumi dati separati dal checkout;
- network dedicata;
- health check;
- limiti risorse;
- restart policy;
- configurazione e segreti non versionati.

Il runtime attivo usa esclusivamente un'immagine o una build identificata da commit e digest. Le modifiche nel checkout `repo/` non cambiano il comportamento live finché non viene approvata e installata una nuova release.

## 43.6 Storage e ARM64

Filesystem/block volume della VPS come archivio operativo. OCI Object Storage non è storage primario né backup automatico. Ogni dipendenza nativa deve funzionare su ARM64 senza emulazione x86 non approvata.

Le build Docker temporanee verificano prima il margine disco, sono serializzate rispetto alle operazioni Docker di Hub Fatture tramite un lock host e rimuovono sempre tag, container e layer di prova. La manutenzione preserva immagine attiva, rollback, immagini in uso ed eventuali candidati VPS qualificati esplicitamente trattenuti; non usa pulizie globali non qualificate.

## 43.7 Bootstrap e trasferimento orchestrati da Codex

L'handover iniziale avviene tramite un unico archivio ZIP consegnato a Codex sul Mac o sul PC Windows già abilitato all'accesso amministrativo. Codex deve occuparsi direttamente di:

1. estrazione temporanea e verifica locale del pacchetto;
2. individuazione o richiesta mirata del target SSH/Tailscale;
3. preflight remoto in sola lettura;
4. richiesta di un'unica autorizzazione prima delle prime scritture remote;
5. trasferimento autonomo con `rsync`, `scp` o mezzo equivalente;
6. verifica ripetuta sulla VPS;
7. esecuzione dello script di bootstrap incluso nel pacchetto;
8. creazione del layout `/opt/sequent/` e collocazione delle fonti private;
9. inizializzazione del checkout e creazione del repository GitHub quando autorizzato.

L'owner non deve eseguire manualmente `scp`, `ssh`, `unzip`, `mkdir`, `git init` o `gh repo create`. Può essere richiesto soltanto di selezionare il target quando ambiguo, completare autenticazioni interattive, autorizzare `sudo` e approvare le modifiche remote previste.

Il bootstrap non autorizza modifiche a Caddy, Dynu, firewall, Hub Fatture o servizi live e non autorizza il deploy pubblico.

---

# 44. Separazione da Hub Fatture

Sequent e Hub Fatture condividono soltanto host fisico e Caddy.

```text
<directory-privata-co-tenant>/
/opt/sequent/
```

Devono avere Compose, network, utente, volumi, hostname, segreti, pipeline, limiti risorse, log e procedure di restore separati. Il container Sequent non accede ai dati o ai segreti di Hub Fatture. Il checkout Codex di Sequent non riceve credenziali o mount di Hub Fatture. Un restore Sequent non tocca Hub Fatture; il guasto dell'host resta l'unico rischio comune inevitabile.

OCR, LibreOffice e Codex eseguono un solo job pesante alla volta con limiti misurati sulla VPS reale. Se si osserva degrado di Hub Fatture, il job Sequent viene sospeso o lanciato in finestre controllate.

---

# 45. Sviluppo VPS-first e dati reali

## 45.1 Ambiente canonico

La VPS OCI ospita l'unica istanza operativa, il checkout remoto `/opt/sequent/repo/`, le fonti ufficiali e i corpus privati. Il primo collegamento, il trasferimento del pacchetto e la creazione del checkout sono orchestrati da Codex a partire dall'unico ZIP consegnato sul Mac o sul PC Windows.

Un clone locale è un ambiente di sviluppo ordinario e completo per codice, documentazione, dipendenze e test sintetici. Può essere usato come checkout principale di una sessione Codex e si sincronizza con il checkout VPS tramite Git. Non diventa per questo una seconda istanza Sequent, non ospita dati operativi o fonti ufficiali e non autorizza un runtime locale sui dati reali.

Non esistono installazioni permanenti separate `development`, `staging` e `production`. Esistono una sola istanza, un solo database operativo, un solo archivio documentale, un solo hostname e un solo set di segreti.

Il Mac resta:

- client principale per accedere al checkout remoto;
- ambiente locale di sviluppo e verifica con fixture sintetiche;
- browser reale per Safari e Chrome;
- banco di prova canonico per SuccessioniOnLine e Java;
- sede della copia privata della configurazione amministrativa strettamente necessaria a raggiungere e verificare la VPS, sempre esclusa da Git.

Le build Docker ARM64 locali passano da un solo wrapper con soglia preventiva sul disco. Il wrapper riusa il tag canonico, conserva al massimo la revisione locale corrente e rimuove soltanto immagini precedenti non referenziate da container; non interviene su volumi, database o immagini di altri prodotti. Il daemon Colima applica inoltre il garbage collector nativo di BuildKit con un budget di cache esplicito, separato dalla retention delle immagini.

Windows resta una piattaforma browser supportata per Chrome ed Edge, ma non è un ambiente di sviluppo richiesto. Un eventuale banco di prova Windows per SuccessioniOnLine viene usato soltanto a sviluppo concluso, se già disponibile; la sua predisposizione e l'esecuzione del collaudo non sono requisiti di accettazione.

## 45.2 Separazione checkout/runtime

Codex può modificare liberamente il branch di lavoro nel checkout Git, ma:

- il servizio attivo non esegue la working tree;
- codice non committato non viene copiato nel runtime;
- il checkout non monta `data/` in scrittura;
- migrazioni e comandi applicativi contro i dati reali richiedono una release approvata o un'azione amministrativa esplicita;
- prima del go-live la stessa istanza può essere usata per spike e dati sintetici; dopo il go-live continua a essere aggiornata tramite release, senza creare un secondo ambiente.

## 45.3 Dati reali e corpus

Dati reali, DIZ, OCR, diagnostica e corpus storico possono risiedere in `/opt/sequent/private/` o nell'archivio applicativo. Restano vietati in:

- Git;
- GitHub Actions;
- artifact pubblici;
- issue o PR pubbliche;
- log condivisi;
- fixture del repository.

Le fonti ufficiali e il corpus privato devono avere una copia di sicurezza indipendente quando contengono risultati di reverse engineering o materiale non facilmente ricostruibile.

## 45.4 Prove rischiose

Per migrazioni, restore, import DIZ, modifiche al modello dati e operazioni distruttive viene creata una copia temporanea coerente in `tmp/` o in un volume Docker isolato. Non si mantiene un secondo ambiente sempre acceso.

Una prova superata produce codice, test e istruzioni ripetibili; non produce un merge automatico dei dati temporanei nell'archivio operativo.

## 45.5 Test sintetici e CI

La CI usa:

- fixture sintetiche;
- DIZ sintetici;
- documenti generati;
- corpus senza dati personali;
- mock delle fonti esterne.

Il benchmark completo con dati reali viene eseguito sulla VPS tramite comandi controllati e risultati sanitizzati, mai in GitHub Actions pubbliche.

## 45.6 Round-trip esterno

Il ciclo con SuccessioniOnLine resta deliberatamente esterno all'istanza:

```text
Sequent sulla VPS
→ download del DIZ candidato
→ apertura/salvataggio e telematico su macOS
→ caricamento dei risultati nel laboratorio VPS
→ confronto automatico
```

Questo è il collaudo canonico del software ufficiale, non un secondo ambiente Sequent. A sviluppo concluso lo stesso ciclo può essere ripetuto facoltativamente su Windows senza diventare un criterio di accettazione.

---

# 46. Repository e workflow Git

## 46.1 Repository e checkout VPS

Repository: `Sequent`. Visibilità pubblica. Nessuna licenza, salvo futura decisione.

Il checkout operativo canonico è `/opt/sequent/repo/`; i clone locali sono normali ambienti di sviluppo. Codex inizializza il repository sulla VPS, crea autonomamente il remote GitHub pubblico quando autorizzato, configura le esclusioni private prima del primo commit e lavora su branch brevi. L'owner può dover completare l'autenticazione GitHub, ma non deve creare manualmente repository, remote o primi commit. Git e l'HEAD esatto mantengono allineati i checkout senza trasformare il clone locale in una seconda istanza.

## 46.2 Branch e merge

- branch brevi;
- pull request;
- Conventional Commits o convenzione documentata;
- merge squash;
- branch protection;
- niente push diretto su `main` salvo emergenza documentata.

## 46.3 CI

Ogni PR esegue gate proporzionati, determinati dalla diff con fallback conservativo:

- **rapido** per sole modifiche documentali e metadati pubblici innocui;
- **ordinario** per codice applicativo che non tocca confini sensibili;
- **sensibile** per browser, runtime, dipendenze, persistenza, autenticazione, documenti, DIZ, fonti ufficiali o governance dei gate;
- **release** per la matrice completa della candidata approvata.

Un check aggregatore sempre presente verifica che tutti e soltanto i job richiesti dalla classificazione siano verdi. Un file non classificato, una diff vuota inattesa, un job cancellato o un output mancante falliscono chiusi. La classificazione decide quali suite aggiungere, non può trasformare un finding o un errore reale in advisory.

Svelte Doctor gira una sola volta nelle PR ordinarie e sensibili. Chromium e WebKit girano in job isolati e paralleli dentro un'immagine Playwright fissata per digest. Browser e immagine ARM64 sono obbligatori quando la diff tocca i relativi confini; la release esegue sempre entrambi. Prima della release resta obbligatoria la suite completa, ma una candidata può riusare l'evidenza verde dell'HEAD della PR quando lo squash produce lo stesso albero Git. Il push dello squash su `main` non ripete i job pesanti già coperti dalla PR e dalla candidata.

## 46.4 Release e attivazione

Il merge su `main` da solo non modifica il servizio attivo. Una richiesta affermativa `Pubblica` approva però l'intero ciclo tecnico applicabile: per sole modifiche documentali, di test o di governance termina dopo merge e pulizia; per una modifica runtime include candidata completa e, quando esiste già una release attiva e il workflow Production è qualificato, deploy, readback live e GitHub Release senza una seconda conferma.

La prima attivazione stabile resta una decisione distinta: richiede autorizzazione esplicita perché introduce servizio e hostname operativi e può coinvolgere Caddy, Dynu o firewall. Prima di tale autorizzazione `Pubblica` può qualificare l'artefatto ma non attiva il servizio.

## 46.5 Chiusura obbligatoria della pubblicazione

Una pubblicazione non è conclusa al merge, alla candidata o al deploy. Prima di qualunque mutazione remota l'orchestratore verifica che la pulizia locale sia eseguibile senza sovrascrivere lavoro concorrente. Al termine aggiorna e verifica `main`, rimuove il branch locale e remoto e l'eventuale worktree creati per il ciclo corrente soltanto dopo avere dimostrato l'equivalenza dell'albero con `origin/main`, quindi inventaria worktree, branch e stash residui. Gli elementi estranei o non integrati vengono preservati e dichiarati esplicitamente nel riepilogo macchina.

L'impossibilità di riallineare `main`, una working tree non pulita, un branch remoto corrente ancora presente o un residuo del ciclo corrente rendono incompleta la chiusura e fanno fallire il comando. L'esecuzione remota è consentita soltanto attraverso il wrapper che applica questo gate; il comando interno non accetta direttamente `--execute`.

## 46.6 Dependabot

Settimanale per:

- npm;
- GitHub Actions;
- immagini Docker.

Patch e minor possono auto-merge dopo gate, tranne componenti critici. Major e runtime/toolchain/DIZ/OCR/Codex richiedono approvazione deliberata.

## 46.7 File obbligatori iniziali

- `AGENTS.md`;
- `README.md`;
- `CHANGELOG.md`;
- `.gitignore` robusto;
- `.gitattributes`;
- configurazioni Oxfmt/Oxlint;
- workflow CI;
- template PR;
- Dependabot;
- `docs/MASTER_PLAN.md`;
- `private/official-sources/manifest.json`, versionato nel repository;
- `scripts/official-sources/verify.ts`;
- catalogo ufficiale derivato e test di conformità.

---

# 47. Architettura della documentazione

## 47.1 Struttura minima

```text
docs/
├── MASTER_PLAN.md
├── ADR/
├── contracts/
│   ├── diz.md
│   ├── data-model.md
│   └── official-compliance.md
├── runbooks/
│   ├── vps-operations.md
│   └── backup-restore.md
└── brand/
    └── brand-foundation.md
```

Fuori dal repository pubblico, sotto `/opt/sequent/`:

```text
private/
└── official-sources/
    ├── manifest.json
    ├── artefatti ufficiali verificati dal manifest
    └── albero XSD estratto e verificato
```

Alla radice:

- `README.md`;
- `AGENTS.md`;
- `CHANGELOG.md`.

## 47.2 Regole

- niente `docs/INDEX.md`, cartelle `evidence/` o `audits/` obbligatorie;
- niente decision register distinto dagli ADR;
- niente glossario finché la terminologia non crea un problema reale;
- niente registro errori documentale separato;
- niente `CLAUDE.md` o `COPYRIGHT.md` separati salvo necessità effettiva;
- test, PR, release e runbook brevi costituiscono prova sufficiente delle normali attività;
- contratti e ADR nascono soltanto quando esiste contenuto stabile riutilizzato da più moduli.

---

# 48. Strategia di test

## 48.1 Principi

- testare invarianti e comportamenti;
- ogni bug fiscale, DIZ, offline o di persistenza produce regressione;
- i dati reali restano nelle directory private o operative della VPS e fuori da CI;
- Codex viene benchmarkato, non trattato come deterministico;
- il controllo reale di SuccessioniOnLine non viene sostituito definitivamente da mock.

## 48.2 Livelli

### Unitari

Calcoli, quote, devoluzione, validazioni, gerarchia fonti, parser, regole, job state machine e normalizzazioni.

### Integrazione

SQLite/migrazioni, filesystem/hash, import documenti, OCR orchestrato, output Codex, DIZ, autenticazione, FTS5, backup e recupero job dopo riavvio.

### Component/UI

Form, `Da verificare`, workspace fonti, autosave, stati, tastiera, layout desktop/mobile e conflitti semplici.

### E2E

Onboarding, login, nuova pratica, import DIZ, revisione, devoluzione, export/reimport DIZ, offline selettivo, backup, cancellazione e update/rollback.

### Manuali qualificati

SuccessioniOnLine su macOS, browser reali, mobile, Codex subscription e disaster recovery. Il collaudo di SuccessioniOnLine su Windows è facoltativo, si svolge soltanto a sviluppo concluso e resta fuori dai gate.

## 48.3 Browser matrix

Prima di una release stabile:

- Safari e Chrome su macOS;
- Chrome ed Edge su Windows;
- Safari iOS/iPadOS per il perimetro mobile.

Playwright copre Chromium/WebKit; almeno un ciclo manuale usa browser e sistemi reali.

## 48.4 Offline

- download di una pratica selezionata;
- reload senza rete;
- modifica e allegato in coda;
- revisione server cambiata e salvataggio della copia locale;
- storage insufficiente;
- cache parziale/cancellata;
- migrazione schema;
- export delle modifiche locali dopo restore server.

## 48.5 Database e blob store

- versione SQLite runtime;
- WAL, foreign key e busy timeout;
- crash durante scrittura documento/job;
- temp/hash/rename/link DB;
- orfani e integrity scan;
- migrazioni;
- Online Backup e restore;
- ricostruzione FTS.

## 48.6 Sicurezza essenziale

- password hashing;
- cookie e CSRF;
- session fixation/rotazione/revoca;
- XSS in nomi file, OCR e output Codex;
- path traversal ZIP;
- accesso non autorizzato ai file;
- macro/script non eseguiti;
- segreti assenti da Git/log;
- isolamento da Hub Fatture.

Non sono gate permanenti matrici enterprise su egress, Turnstile, migrazione RP ID o prompt injection in ogni formato.

## 48.7 DIZ

Golden file, modifiche one-field, round-trip semantico, unknown blocks, allegati, versioni, dichiarazioni successive, salvataggio e telematico ufficiale su macOS, oltre a test automatici su percorsi relativi, separatori, codifiche, terminatori di riga e metadati. Un ciclo Windows può essere eseguito a sviluppo concluso come verifica advisory facoltativa; una divergenza DIZ riproducibile eventualmente osservata segue i normali criteri di arresto.

## 48.8 Backup e restore

- breve maintenance mode;
- snapshot SQLite consistente;
- documenti e manifest;
- checksum;
- esclusione di segreti e credenziali;
- restore CLI su VPS esistente e nuova;
- nuovo bootstrap account;
- pacchetto singola pratica.

## 48.9 Gate CI

Ogni PR e ogni release mantengono il livello di controllo definito in «Repository e workflow Git» e «Versioning, release e aggiornamenti», inclusi Oxfmt, Oxlint, Svelte check, test, build, E2E pertinenti, browser matrix di release e benchmark. Non esiste un gate separato di tracciabilità documentale.

Dallo scaffolding SvelteKit, Svelte Doctor gira in CI sulle PR ordinarie e sensibili e nella matrice completa di release. Il suo risultato confluisce nel check aggregatore required. Qualunque finding, errore operativo o output non interpretabile rende rosso il check; soltanto una soppressione stretta e motivata di un falso positivo può ripristinarlo. Il job non applica fix e non carica sorgenti, prompt o risultati verso servizi AI esterni.

I controlli rapidi non duplicano la suite applicativa. I controlli pubblici ordinari non duplicano Svelte Doctor. La cache dei browser può riutilizzare i binari Playwright identificati dal lockfile, ma le dipendenze di sistema vengono verificate sul runner corrente.

## 48.10 Suite di conformità alle fonti ufficiali

La suite ufficiale deve includere:

- verifica hash e manifest di tutti gli artefatti e XSD dichiarati;
- coverage report di tutte le pagine/campi di `SRC-03` e di tutti gli elementi dichiarativi SUC13;
- XSD validation e test di tipi, sequenze, choice, cardinalità ed enumerazioni;
- test positivi e negativi per ogni annotazione tecnica convertita in regola;
- test delle istruzioni e degli esempi ufficiali di Fascicolo 1 e Fascicolo 2;
- test specifici per ogni voce di modifica di `SRC-01`, `SRC-02` e `SRC-09`;
- test di coerenza label modello ↔ campo canonico ↔ percorso XSD;
- test delle dichiarazioni sostitutive 1, 2 e 3;
- test di Quadro EF e imposta di successione per le date applicabili;
- test trust, disabilità, agevolazioni, riduzioni, diritto di abitazione, prima casa, EG/EH ed EI;
- test di allegati PDF/A/TIFF, 5 MB e totale 40 MB;
- comparazione con il software ufficiale su casi sintetici e pratiche storiche;
- blocco su regole `unresolved`, campi senza provenienza e divergenze non spiegate.

Il coverage non è una semplice percentuale di righe PDF: deve dimostrare che ogni campo/elemento del perimetro ha mapping, regola o classificazione esplicita.

---

# 49. Benchmark OCR e Codex

## 49.1 Dataset

Il benchmark usa pratiche storiche concluse con risultato atteso derivato dalla dichiarazione effettivamente presentata e dalle correzioni professionali.

Categorie separate:

- PDF nativi;
- PDF scansionati;
- fotografie;
- XML;
- Excel;
- documenti anagrafici;
- visure;
- certificazioni bancarie;
- testamenti;
- passività;
- DIZ.

## 49.2 Classificazione degli esiti

Per ogni campo:

- corretto e fonte corretta;
- corretto ma fonte incompleta;
- errato;
- non trovato;
- correttamente lasciato da verificare;
- inventato;
- fonte inventata;
- conflitto correttamente rilevato;
- conflitto ignorato.

## 49.3 Pesi

Ordine di gravità:

1. fonte inventata;
2. dato critico errato presentato come affidabile;
3. conflitto critico ignorato;
4. dato non critico errato;
5. dato corretto lasciato da verificare;
6. dato non trovato.

## 49.4 Soglie go-live

- zero fonti inventate;
- zero valori critici errati accettati silenziosamente;
- tutti i campi critici corretti o da verificare;
- precisione non critica almeno 98%;
- nessuna regressione critica rispetto alla release precedente.

## 49.5 Riproducibilità

Ogni esecuzione registra:

- commit;
- modello ed effort;
- versione prompt;
- versione OCR;
- versione regole;
- corpus hash;
- risultati aggregati e per campo.

Le run Codex possono variare; il benchmark usa più esecuzioni quando necessario per evitare conclusioni basate su una singola run fortunata.

## 49.6 Uso delle pratiche reali

Il benchmark completo con dati reali viene eseguito sulla VPS in un comando controllato o su una copia temporanea isolata, mai in GitHub Actions pubbliche. In Git restano solo risultati sanitizzati e fixture sintetiche.

---

# 50. Performance e affidabilità

## 50.1 Priorità

L'interfaccia resta utilizzabile durante OCR o Codex. Correttezza e recuperabilità prevalgono sulla micro-ottimizzazione.

## 50.2 Target iniziali

- Dashboard utilizzabile in pochi secondi su rete ordinaria;
- autosave locale quasi immediato;
- ricerca percepita come immediata sui volumi previsti;
- upload riprendibile;
- nessun blocco dell'event loop durante processi figli;
- rendering progressivo dei documenti;
- uso memoria browser controllato.

## 50.3 Affidabilità

- originali immutabili;
- checksum;
- operazioni idempotenti;
- transazioni brevi;
- errori espliciti;
- retry controllati;
- nessuna perdita silenziosa.

## 50.4 Risorse VPS

Un solo job pesante alla volta, con timeout e limiti CPU/RAM del processo figlio. Le soglie vengono misurate con Hub Fatture attivo.

## 50.5 Disco

Monitorare spazio totale, dati, diagnostica, derivati, snapshot e temporanei. Non iniziare una conversione che rischia di esaurire il volume senza avviso.

## 50.6 Shutdown e deploy

Il processo smette di accettare nuove operazioni rischiose, interrompe o marca il job corrente come recuperabile e chiude SQLite correttamente.

---

# 51. Monitoraggio e incidenti

## 51.1 Monitoraggio minimo

- un OCI Health Check HTTPS esterno;
- allarme spazio disco;
- restart policy Docker;
- log errori recenti e stato ultimo backup visibili nell'app;
- e-mail OCI soltanto per indisponibilità o disco critico, senza dati pratica.

Nel perimetro iniziale non sono richieste dashboard tecniche complesse, classificazioni P0–P3 o allarmi dettagliati CPU/memoria.

## 51.2 Feature flag operative

Sono sufficienti:

```text
CODEX_ENABLED
DIZ_EXPORT_ENABLED
```

Servono a disabilitare rapidamente le due capacità più rischiose senza cancellare dati.

## 51.3 Incident runbook

Il runbook dell'istanza VPS copre soltanto:

1. verifica health/log/disco;
2. disabilitazione della capacità interessata;
3. rollback dell'ultima release quando pertinente;
4. verifica integrità e restore se necessario;
5. aggiunta di un test di regressione per difetti critici.

---

# 52. Versioning, release e aggiornamenti

## 52.1 Semantic Versioning

Le release seguono `MAJOR.MINOR.PATCH`: major per cambiamenti incompatibili deliberati, minor per funzioni compatibili e patch per correzioni compatibili. La versione della release stabile iniziale viene scelta al momento della sua approvazione, non anticipata negli altri documenti.

`package.json`, tag Git, changelog, GitHub Release e digest Docker identificano la release. L'istanza attiva usa soltanto release stabili approvate.

## 52.2 Working tree e release attiva

Il checkout `/opt/sequent/repo/` può contenere branch e modifiche in corso senza influire sul servizio. Una candidata nasce dopo merge su `main`, supera i gate e diventa la release attiva soltanto dentro un ciclo tecnico approvato dall'owner. La richiesta affermativa `Pubblica` costituisce tale approvazione per gli aggiornamenti di un runtime già attivo; la prima attivazione richiede invece un'autorizzazione esplicita separata.

La pubblicazione può essere orchestrata da un comando unico che verifica branch, working tree, classificazione, preflight locale, PR, required checks, squash merge, identità dell'albero Git, eliminazione del branch e rilettura finale. Il preflight exact-HEAD può produrre una ricevuta locale esterna alla working tree, legata a commit, tree, lockfile, toolchain, piattaforma e comandi ed è riusabile soltanto entro una finestra breve. Il comando resta in dry-run senza l'opzione esplicita di esecuzione. Con `--execute`, usato soltanto dopo `Pubblica`, completa anche la candidata per le modifiche runtime e il deploy/readback quando rileva una Production già attiva e il relativo workflow qualificato. Dopo il merge e prima di ogni dispatch rilegge la Production attiva o riuscita e ricalcola il diff operativo, attendendo una distribuzione concorrente quando questo evita una candidata ridondante. Infine riallinea `main`, rimuove branch e worktree del ciclo corrente già integrati, inventaria stash e residui concorrenti e fallisce se non può dimostrare la chiusura. Modifiche esclusivamente documentali, di test o di governance non producono immagini, release o deploy, ma attraversano comunque la stessa pulizia finale.

L'impatto runtime viene valutato in modo conservativo. Un percorso sconosciuto presume impatto runtime; il diff operativo della distribuzione parte dall'ultima release attiva verificata, così più merge runtime correlati vengono distribuiti insieme una sola volta. Un cambiamento a `package.json` e `package-lock.json` viene escluso dai gate ARM64 soltanto quando il confronto strutturale prova che sono cambiati esclusivamente i campi di versione. Versione e changelog, quando richiesti, sono completati nella stessa pull request della modifica runtime.

È vietato:

- avviare il servizio operativo dalla working tree;
- copiare manualmente file non committati nel runtime;
- eseguire migrazioni non qualificate sul database operativo;
- usare il database reale come fixture di test.

## 52.3 Gate release stabile

Restano confermati i gate rigorosi già scelti:

- Oxfmt/Oxlint/Svelte check;
- test unitari, integrazione, migrazioni ed E2E;
- DIZ regression;
- benchmark OCR/Codex;
- build ARM64 e scansione dipendenze/immagine; errori dello scanner e vulnerabilità con fix disponibile bloccano la candidata, indipendentemente dalla severità. Le vulnerabilità senza fix distribuibile, incluse quelle Critical, restano advisory accettate e tracciate: conteggi, severità e identificativi devono rimanere visibili fino all'aggiornamento della base o dei converter;
- browser matrix;
- nessun blocker aperto;
- rollback verificabile;
- chiusura dei Technical Gate pertinenti, incluso `TG-COMPLIANCE`;
- source bundle verificato;
- report di coverage ufficiale senza campi o regole non classificati nel perimetro dichiarato;
- pacchetto sintetico accettato dal controllo ufficiale.

L'accessibilità viene verificata sui requisiti pratici definiti in «Brand, UI, accessibilità e localizzazione», senza audit WCAG formale separato.

La candidata pubblica costruisce l'immagine ARM64 una sola volta. Lo stesso job prova il runtime, crea un archivio esclusivamente temporaneo per la scansione locale, lo elimina, pubblica l'immagine su GHCR e ne esegue il readback per riferimento immutabile. Un piccolo manifest lega versione, commit, albero Git, piattaforma e digest GHCR; solo il manifest passa alla Production. Una divergenza qualunque obbliga a ricostruire e ricertificare la candidata.

## 52.4 Preflight sulle modifiche rischiose

Prima di una release che modifica schema dati, import/export, backup/restore, DIZ o pipeline documentale:

1. viene creata una copia coerente temporanea dei dati necessari;
2. migrazione e rollback vengono provati sulla copia;
3. vengono verificati integrità, tempi e spazio disco;
4. la copia viene eliminata o conservata soltanto per un difetto riproducibile.

Non serve un ambiente staging permanente.

## 52.5 Deploy dell'unica istanza

Dopo approvazione:

1. GitHub Actions costruisce o seleziona l'immagine ARM64 per digest;
2. verifica la VPS e la release attualmente attiva;
3. attiva una breve modalità manutenzione e blocca nuove mutazioni;
4. attende o interrompe in sicurezza il job attivo;
5. crea lo snapshot tecnico previsto;
6. esegue il pull del digest GHCR prima della manutenzione, poi migrazioni e aggiornamento del servizio `sequent`;
7. esegue health check e smoke test;
8. riapre l'applicazione;
9. ripristina immagine e snapshot precedenti se uno dei controlli fallisce.

Non è richiesto zero downtime. Non viene creato un evidence pack formale per ogni deploy. L'app non possiede credenziali GitHub o accesso al socket Docker.

## 52.6 Aggiornamenti automatici

Una release stabile approvata viene distribuita senza SSH manuale. Dopo il readback Production riuscito l'orchestratore crea e rilegge automaticamente tag e GitHub Release della versione candidata. La pulizia Docker ordinaria resta fuori dal percorso critico ed è demandata al timer selettivo; soltanto un deploy annullato tenta una pulizia immediata di recupero. `Pubblica` autorizza la distribuzione tecnica applicabile di una modifica runtime su un'istanza già attiva, ma non esiste auto-pubblicazione a ogni merge e una PR documentale, di test o di governance non avvia il deploy. Non esiste promozione Development → Production: si sostituisce soltanto la release attiva dell'unica istanza. La prima attivazione resta separata.

## 52.7 Dipendenze

La policy Dependabot settimanale resta invariata. Patch/minor non critiche possono auto-merge dopo i gate; runtime, toolchain, Codex, SQLite, OCR, Oxfmt/Oxlint, DIZ e major richiedono approvazione deliberata.

## 52.8 SuccessioniOnLine

Ogni parser/writer dichiara le versioni qualificate. Una versione sconosciuta può disabilitare l'export finché il round-trip non è verificato.

## 52.9 Vecchia cache browser

L'aggiornamento non elimina modifiche non sincronizzate. Se la migrazione locale non è sicura, la pratica resta in sola lettura e offre export dei dati locali.

---

# 53. Brand, UI, accessibilità e localizzazione

## 53.1 Nome e descrizione

> **Sequent**
> Assistente per le dichiarazioni di successione

Il nome è approvato per uso personale non commerciale.

## 53.2 Identità autonoma

Nessun rapporto visivo esplicito con Pratix, Hub Fatture o Routally. Si possono riutilizzare principi tecnici o UX, non marchio o palette.

## 53.3 Direzione visiva

La direzione approvata è documentata nella Brand Foundation, con simbolo SVG sorgente, wordmark, favicon, palette chiaro/scuro, applicazione Dashboard/workspace e verifica monocromia/piccole dimensioni.

Direzione concettuale confermata:

- sequenza, passaggio e ricomposizione;
- simbolo geometrico astratto;
- area esplorativa blu profondo + verde minerale/teal;
- niente alberi genealogici, bilance, pergamene o simboli funebri.

## 53.4 UI

- professionale e sobria;
- densa ma ordinata;
- colori soprattutto per stato e affidabilità;
- animazioni minime;
- tipografia di sistema;
- nessun webfont;
- tema automatico più override chiaro/scuro.

## 53.5 Accessibilità proporzionata

Requisiti del perimetro iniziale:

- HTML semantico;
- label e descrizioni;
- focus visibile;
- uso completo da tastiera nei flussi principali;
- contrasto sufficiente;
- errori associati ai campi;
- nessuna informazione affidata soltanto al colore;
- zoom/reflow ragionevoli;
- riduzione movimento dove pertinente.

Non è previsto un gate formale WCAG o una matrice screen reader a ogni release, salvo futura esigenza dell'owner.

## 53.6 Lingua

Solo italiano nel perimetro iniziale, con formati italiani, euro e timezone `Europe/Rome`. Codice e nomi tecnici restano in inglese; le stringhe visibili sono centralizzate senza introdurre un framework i18n sproporzionato.

---

# 54. Costi, sostenibilità e ownership

## 54.1 Budget

Costi obbligatori target:

- subscription Codex già posseduta;
- VPS OCI già posseduta;
- nessun costo incrementale previsto;
- Dynu gratuito;
- Tailscale gratuito nel perimetro personale;
- GitHub pubblico;
- strumenti open source.

## 54.2 Divieti economici

Non introdurre senza approvazione:

- API a consumo;
- database managed;
- storage SaaS;
- OCR cloud;
- e-mail transazionali;
- domini a pagamento;
- servizi monitoring a pagamento;
- licenze documentali commerciali.

## 54.3 Ownership

Matteo possiede:

- repository;
- account OCI;
- Dynu;
- Tailscale;
- account ChatGPT/Codex;
- credenziali VPS, runtime e deploy;
- corpus storico;
- decisioni di prodotto;
- backup.

## 54.4 Sostenibilità

Il prodotto deve essere mantenibile da Codex con documentazione e test, senza richiedere un team operativo. Ogni nuova dipendenza aumenta il costo di manutenzione e deve dimostrare valore.

---

# 55. Technical spike e validation gate

Un Technical Gate esiste soltanto quando una prova può cambiare materialmente architettura o fattibilità. Tutto il resto è un normale requisito o test del relativo risultato di implementazione.

## TG-COMPLIANCE — Pacchetto ufficiale completo

**Criteri:**

- tutti gli artefatti dichiarati coincidono per SHA-256, dimensione e, per i PDF, numero di pagine;
- manifest, digest composito delle fonti e digest dell'albero XSD sono riproducibili;
- tutti gli XSD dichiarati sono well-formed e il main schema indicato dal manifest compila usando esclusivamente le dipendenze locali del bundle;
- tutti i campi del modello e gli elementi SUC13 del perimetro hanno mapping e provenienza;
- Fascicolo 1, Fascicolo 2, guida di calcolo e relativi allegati sono tradotti in regole o classificazioni esplicite;
- gli overlay correnti `SRC-01` e `SRC-09` sono applicati e testati integralmente;
- `SRC-02` e `SRC-06` sono riconciliati come lineage e non possono reintrodurre regole superate;
- la catena di autoliquidazione e tutti gli esempi di `SRC-10` hanno golden test con valori intermedi;
- approvazione, chiarimenti e codici di pagamento `SRC-11`–`SRC-14` sono riconciliati con campi, calcoli, scadenze e pagamenti;
- norme e correttivi `SRC-16`–`SRC-22` hanno una linea temporale articolo per articolo collegata alla data di apertura della successione;
- interessi e coefficienti `SRC-23`–`SRC-26` hanno valori versionati e test per ciascun periodo, e `SRC-27` ha almeno un caso storico pertinente;
- SUC13 2.3.1, guida operativa, ricevute, Modello 4 e archivi correnti `SRC-15`, `SRC-28`–`SRC-31` sono qualificati nei limiti del rispettivo ruolo;
- pagina di distribuzione, programma, utilità, manuali e deposito SUC13 `SRC-32`–`SRC-40` coincidono con il bundle e sono stati confrontati con i canali ufficiali vivi;
- XSD, validator, allegati, dichiarazioni sostitutive e regole temporali superano la suite di conformità alle fonti ufficiali;
- non restano elementi `unresolved` che possano alterare DIZ, calcoli, allegati o telematico;
- il report di conformità è comprensibile e riproducibile.

**Blocca:** congelamento del dominio, writer DIZ productizzato, flusso ufficiale e go-live.

## TG-DIZ — Identificazione e round-trip

**Obiettivo:** capire il formato, costruire parser/writer, preservare allegati e blocchi sconosciuti, dimostrare apertura, salvataggio e telematico con SuccessioniOnLine su macOS ed escludere dipendenze del DIZ dal sistema operativo mediante test deterministici di portabilità.

Il collaudo con SuccessioniOnLine su Windows è una verifica finale facoltativa e advisory: non partecipa alla chiusura di `TG-DIZ` e non richiede la predisposizione di una VM o di un PC dedicato.

**Fallimento:** apre il Decision Gate sul componente locale/Java minimo.

## TG-TOOLCHAIN — Toolchain web e ARM64

**Criteri:** build/dev server, Svelte check con il compatibility layer richiesto, compilatore TypeScript primario, verifica `tsgo` quando compatibile, Oxlint, Oxfmt Svelte, Vitest, Playwright, adapter-node e immagine ARM64; toolchain di rollback qualificata finché la linea corrente non è stabilizzata.

## TG-CODEX — Subscription sulla VPS

**Criteri:** login headless, persistenza credenziali, SDK, thread, run strutturate, immagini, output schema, riavvio, riautenticazione e assenza di API key.

## TG-DOCUMENTS — Pipeline documentale ARM64

**Criteri:** formati definiti in «Formati e limiti di caricamento», OCR italiano, conversioni, limiti risorse, processi figli e assenza di impatto critico su Hub Fatture.

## TG-OFFLINE — Browser reali

**Criteri:** pratica selezionata offline, IndexedDB/Blob, storage insufficiente, modifica/allegato in coda, migrazione schema, cache rimossa ed export delle modifiche locali dopo restore server sui browser supportati.

## TG-GOLIVE — Validazione storica e pratica reale

**Criteri:** 5–10 pratiche storiche, benchmark senza errori critici silenziosi, catalogo ministeriale e regole coerenti con il perimetro, browser matrix, backup/restore provati e una pratica reale nuova lavorata in parallelo e riconciliata.

---

# 56. Milestone di implementazione

Ogni milestone contiene già i propri criteri di uscita; non esistono Definition of Done o epiche parallele.

Gli identificatori delle milestone restano confinati a questo capitolo canonico. Le denominazioni possono essere richiamate nella documentazione di governance, mentre il codice permanente usa esclusivamente termini di dominio o del ciclo di vita applicativo e non incorpora nomi o nomenclatura di roadmap.

## M0 — Bootstrap VPS, repository, source bundle e DIZ Lab

**Obiettivo:** partendo dall'unico ZIP consegnato all'agente, Codex verifica localmente il pacchetto, individua e valida la VPS, trasferisce autonomamente i file, predispone il layout `/opt/sequent/`, inizializza checkout e repository GitHub, versiona gli artefatti ministeriali pubblici e l'albero XSD, verifica manifest/hash e prepara pipeline del catalogo, corpus DIZ privato e strumenti di analisi.

**Uscita:** trasferimento e bootstrap eseguiti da Codex senza comandi manuali delegati all'owner; VPS preflight completato; checkout separato da runtime e dati; repository GitHub creato, fonti ministeriali pubbliche versionate e dati privati esclusi; source bundle verificato localmente e sulla VPS; scheletro del catalogo derivato; ambiente riproducibile e piano eseguibile per `TG-COMPLIANCE` e `TG-DIZ`; nessun hostname pubblico o UI completa richiesti.

## M1 — Interoperabilità DIZ

**Prerequisito:** M0.

**Risultato:** parser/writer prototipo, preflight legale e round-trip qualificato su macOS con test deterministici di portabilità del formato.

**Uscita:** `TG-DIZ` chiuso oppure Decision Gate esplicito sul fallback locale/Java; mapping DIZ collegato al catalogo ufficiale, senza deroghe implicite.

## M2 — Fondazioni applicative e istanza unica

**Prerequisito:** verdetto M1.

**Risultato:** SvelteKit, processo unico, SQLite/filesystem, autenticazione semplice, job persistenti, Docker ARM64, CI, runtime a release separato dal checkout e separazione da Hub Fatture.

M2 comprende inoltre Brand Foundation, design token, shell responsive, Dashboard sui soli dati già disponibili, ricerca iniziale su pratiche e nomi documento, workspace minimo reale e design lab sintetico non esposto nell’istanza normale. Questa anticipazione definisce il linguaggio frontend senza introdurre campi, regole o stati fiscali non qualificati.

**Uscita:** `TG-TOOLCHAIN` chiuso; Brand Foundation e asset vettoriali approvati; shell verificata su desktop, mobile e tema scuro; ricerca, upload e workspace minimo basati su dati reali; servizio non pubblico o live eseguito da release identificata; upload/salvataggio/job/restart/backup base verificati senza eseguire la working tree sui dati operativi.

## M3 — Documenti, OCR e Codex

**Risultato:** acquisizione, originali/derivati, pipeline documentale, workspace fonti, `Da verificare`, Codex SDK e benchmark harness.

**Uscita:** `TG-DOCUMENTS` e `TG-CODEX` chiusi; nessun dato critico errato accettato silenziosamente nel corpus disponibile.

## M4 — Dominio, UX e output

**Risultato:** catalogo ministeriale, procedimento/dichiarazioni, anagrafiche e beni condivisi, checklist, devoluzione, calcoli, regole versionate, completamento della Dashboard e della ricerca con dati di dominio qualificati, doppia vista e output.

**Uscita:** `TG-COMPLIANCE` chiuso; flusso completo interno dalla pratica ai controlli, con conferme professionali richieste e test dominio verdi.

## M5 — Offline selettivo

**Risultato:** pratiche scelte disponibili offline, modifiche/allegati in coda, conflitto semplice, migrazione schema ed export locale di recupero.

**Uscita:** `TG-OFFLINE` chiuso sui browser supportati.

## M6 — Flusso ufficiale e operations

**Risultato:** DIZ productizzato, import/export/reimport, confronto a tre vie DIZ, telematico/ricevute, backup manuale, restore CLI, health check, modalità manutenzione, update e rollback dell'unica istanza. Dopo autorizzazione dell'owner, la stessa istanza viene resa raggiungibile per l'uso personale tramite hostname Dynu dedicato, virtual host Caddy separato e HTTPS, senza pannelli amministrativi pubblici né nuovi ambienti.

**Uscita:** round-trip ufficiale, pacchetto allegati conforme, controllo Agenzia/Sogei superato e procedure operative ripetibili; origine HTTPS canonica, health check attraverso Caddy e autenticazione/sessione verificati sull'endpoint personale.

## M7 — Qualificazione Codex e acquisizione del corpus DIZ

**Prerequisito:** M6 chiusa senza trasferirne o ridurne i criteri di uscita.

**Risultato:** Codex viene qualificato realmente attraverso Sequent sulla VPS con autenticazione ChatGPT, SDK, thread e run strutturate, provenienza verificabile, persistenza dopo riavvio, riautenticazione e indisponibilità controllata. I cinque DIZ già presenti nel corpus privato vengono acquisiti nell'archivio applicativo tramite il percorso productizzato in M6, creando o collegando le pratiche pertinenti, importando tutti i dati rappresentabili e preservando integralmente originali e contenuti non interpretati.

**Uscita:** `TG-CODEX` chiuso con almeno una run reale riproducibile e un benchmark privato controllato senza fonti inventate o valori critici errati accettati silenziosamente; cinque DIZ presenti e consultabili in Sequent con hash, provenienza, pratica/dichiarazione e readback verificati; nessun dato reale in Git, CI o artefatti pubblici. Il caricamento usa mapping, round-trip, backup/restore, health e procedure operative già qualificati in M6 e non ne ridefinisce né sposta i requisiti. Il benchmark storico completo su 5–10 pratiche e la prima pratica reale restano in M8.

## M8 — Validazione e go-live

**Prerequisito:** M7.

**Risultato:** ricostruzione delle pratiche storiche, benchmark, regressioni, prima pratica reale parallela sull'endpoint HTTPS qualificato in M6 e release stabile.

**Uscita:** `TG-GOLIVE` chiuso e approvazione owner.

### Impatto del bundle ufficiale acquisito il 27 agosto 2026

| Milestone | Impatto                                    | Conseguenza operativa                                                                                                                                                                                          |
| --------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0        | diretto, limitato al pacchetto delle fonti | il bundle ampliato, compresi i programmi ufficiali gestiti con Git LFS, deve essere verificato localmente, versionato e poi verificato anche sulla VPS nel ciclo di pubblicazione applicabile                  |
| M1        | nessun cambio strutturale dimostrato       | l’avviso SUC13 2.3.1 aggiorna gli uffici ma non annuncia un nuovo XSD; parser e writer DIZ non cambiano finché un confronto ufficiale non mostra una divergenza                                                |
| M2        | nessun impatto diretto                     | fondazioni, istanza unica e design system non dipendono dai nuovi contenuti fiscali                                                                                                                            |
| M3        | nessun impatto diretto                     | acquisizione documenti, OCR e Codex restano invariati; le nuove fonti possono ampliare solo future estrazioni guidate                                                                                          |
| M4        | diretto e bloccante per la chiusura        | calcoli, regole, scadenze, pagamenti e controlli devono essere riconciliati per periodo con `SRC-11`–`SRC-27`; `TG-COMPLIANCE` resta aperto finché i test non sono completi                                    |
| M5        | nessun impatto diretto                     | l’offline selettivo conserva le versioni delle regole già previste e non richiede una nuova architettura                                                                                                       |
| M6        | diretto                                    | installer e modulo SUC13 sono già disponibili nel bundle; controllo, uffici, Comuni/Stati esteri, allegati e ricevute devono comunque essere riletti dai servizi ufficiali correnti prima del flusso ufficiale |
| M7        | indiretto                                  | i cinque DIZ vengono acquisiti senza reinterpretare le regole applicate; Codex resta assistivo e ogni proposta mantiene la provenienza, mentre mapping e flusso ufficiale restano requisiti già chiusi in M6   |
| M8        | diretto                                    | il corpus storico deve comprendere periodi 2025 e 2026 e almeno il caso anteriore alla riforma interessato dalla sentenza 89/2026                                                                              |

Questa valutazione non anticipa l’esito della riconciliazione fiscale: identifica dove le nuove fonti cambiano i criteri di uscita e dove, invece, non giustificano lavoro aggiuntivo.

Dopo il completamento dello sviluppo, se un ambiente Windows è già disponibile, può essere eseguito un collaudo finale di SuccessioniOnLine. L'assenza dell'ambiente, la mancata esecuzione o un problema esclusivamente ambientale non impediscono l'uscita da M8 né la release. Una divergenza DIZ riproducibile e confermata viene invece trattata come difetto del formato e blocca l'output interessato secondo i criteri ordinari.

---

# 57. Risk register essenziale

| Rischio                                                     | Mitigazione principale                                                   | Condizione di riapertura                             |
| ----------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------- |
| Source bundle incompleto o estratto male                    | manifest/hash, `TG-COMPLIANCE`, coverage e review                        | campo/regola senza provenienza o delta non applicato |
| Nuova fonte ufficiale modifica il modello                   | nuovo bundle, diff e ruleset esplicito                                   | aggiornamento Agenzia rilevato                       |
| DIZ non interoperabile                                      | `TG-DIZ` e fallback locale/Java minimo                                   | round-trip non affidabile                            |
| Formato DIZ cambia                                          | compatibilità versionata e regressioni                                   | nuova versione SuccessioniOnLine                     |
| Codex subscription non stabile sulla VPS                    | `TG-CODEX`, app pienamente operativa senza AI                            | login/policy SDK cambia                              |
| OCR/Codex produce dato critico errato                       | provenienza, review e benchmark con zero errori critici silenziosi       | regressione benchmark                                |
| Regola fiscale obsoleta                                     | fonti ufficiali, versionamento e confronto ufficiale                     | nuova istruzione/modello                             |
| Backup manuale troppo vecchio o VPS persa                   | promemoria, backup verificato e restore CLI                              | ultimo backup oltre soglia/outage                    |
| Offline perde modifiche                                     | cache per pratiche selezionate ed export locale di recupero              | eviction/migrazione fallita                          |
| OCR/Codex impatta Hub Fatture                               | un job pesante, processi figli limitati e monitoraggio                   | degrado osservato                                    |
| Spazio disco esaurito                                       | preflight, alert disco e cleanup diagnostica                             | soglia critica                                       |
| Divergenza con SuccessioniOnLine                            | riconciliazione obbligatoria e test di regressione                       | confronto differente                                 |
| Fattispecie fuori perimetro telematico esportata per errore | regole Modello precedente/Modello 4/ufficio e blocco fail-closed         | nuova casistica o regola non mappata                 |
| Allegati o fornitura non conformi                           | preflight PDF/A/TIFF, 5 MB/file, 40 MB complessivi e controllo ufficiale | modifica tecnica o scarto ufficiale                  |
| Ricevuta classificata in modo errato                        | parser per tipologia, hash, legame alla trasmissione e fixture           | nuovo formato ricevuta                               |

---

# 58. Modalità degradate essenziali

| Evento                                             | Comportamento richiesto                                                      |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| Source bundle mancante o hash errato               | runtime usa solo artefatti già qualificati; rigenerazione e release bloccate |
| Regola ufficiale non risolta                       | campo manuale solo se sicuro; export interessato bloccato                    |
| Allegato non conforme                              | conversione/split; nessun pacchetto finale finché non conforme               |
| Codex non autenticato/quota esaurita               | AI disabilitata o job in attesa; nessuna API fallback                        |
| Internet assente                                   | pratica offline selezionata utilizzabile; sync e job server attendono        |
| OCR o conversione fallisce                         | originale disponibile, retry o inserimento manuale                           |
| Documento/formato non elaborabile                  | conservato e scaricabile, stato esplicito                                    |
| Spazio browser insufficiente                       | pratica non resa offline; nessuna modifica esistente eliminata               |
| Revisione server cambiata                          | versione locale salvabile come copia separata; nessun overwrite silenzioso   |
| VPS ripristinata da backup vecchio                 | export delle modifiche locali e reimport manuale                             |
| Job interrotto da riavvio                          | marcato interrotto e ripreso/ritentato secondo idempotenza                   |
| Spazio VPS critico                                 | blocco nuovi job pesanti e avviso                                            |
| Versione DIZ sconosciuta                           | import conservativo; export disabilitato finché non qualificato              |
| DIZ/calcoli divergono da SuccessioniOnLine         | pratica `Da verificare`, nessuna prevalenza automatica                       |
| Aggiornamento fallisce                             | rollback immagine/snapshot precedente                                        |
| Pratica chiusa da modificare                       | riapertura motivata e nuova revisione                                        |
| Casistica non automatizzata ma ammessa dal modello | manual assisted; nessuna deduzione AI automatica                             |
| Caso da modello precedente, Modello 4 o ufficio    | export disabilitato e percorso alternativo spiegato                          |
| Campo o controllo ufficiale `unresolved`           | pratica consultabile/modificabile, export bloccato                           |
| Controllo ufficiale non disponibile                | telematico non dichiarato pronto per trasmissione                            |
| Allegato non conforme                              | originale conservato, derivato rigenerabile, pacchetto bloccato              |

---

# 59. Requisiti fondamentali

## Conformità ufficiale

| ID      | Requisito                                                                                                                                             |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEQ-C01 | Tutti gli artefatti del manifest macchina, inclusi archivio e albero XSD verificato, costituiscono il source bundle vincolante del perimetro iniziale |
| SEQ-C02 | Ogni campo e regola applicativa conserva provenienza fino a fonte, pagina/sezione e percorso tecnico                                                  |
| SEQ-C03 | `SRC-01` e `SRC-09` sono overlay correnti e integralmente testati; `SRC-02` e `SRC-06` restano lineage non autorevole                                 |
| SEQ-C04 | Modello, istruzioni, guida di calcolo, XSD e specifiche sono riconciliati in un catalogo macchina-leggibile completo                                  |
| SEQ-C05 | La vista per quadri usa etichette e struttura ufficiali con mapping uno-a-uno al modello canonico                                                     |
| SEQ-C06 | Allegati finali rispettano PDF/A-1a/1b o TIFF conforme, 5 MB per file e 40 MB complessivi compressi                                                   |
| SEQ-C07 | Ogni file finale supera validator interni e controllo ufficiale Agenzia/Sogei                                                                         |
| SEQ-C08 | Nessuna regola ufficiale viene aggiornata o migrata silenziosamente                                                                                   |
| SEQ-C09 | Una lacuna o divergenza del catalogo blocca l'export interessato anziché essere colmata per inferenza                                                 |
| SEQ-C10 | Ogni dichiarazione registra source bundle, catalogo e ruleset applicati                                                                               |
| SEQ-C11 | Le fattispecie da modello precedente, Modello 4 o ufficio sono riconosciute e non esportabili                                                         |
| SEQ-C12 | Presentazione, ricevute e volture seguono il ciclo ufficiale; la seconda ricevuta positiva prova la registrazione                                     |

## Prodotto e flusso

| ID      | Requisito                                                                                                           |
| ------- | ------------------------------------------------------------------------------------------------------------------- |
| SEQ-P01 | Web app privata, single-user, self-hosted e utilizzabile da Mac, Windows e browser mobile                           |
| SEQ-P02 | Flusso principale: documenti → estrazione → revisione → DIZ → SuccessioniOnLine → fascicolo finale                  |
| SEQ-P03 | SuccessioniOnLine resta controllo e generatore del telematico                                                       |
| SEQ-P04 | Tutte le tipologie telematiche vigenti previste dal perimetro, con manual assisted per casistiche non automatizzate |
| SEQ-P05 | Nessun costo ricorrente obbligatorio oltre a subscription Codex e risorse già possedute                             |

## Documenti, OCR e AI

| ID      | Requisito                                                                                                                    |
| ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| SEQ-D01 | Originali immutabili, hash e deduplicazione                                                                                  |
| SEQ-D02 | Supporto ai formati e agli output definiti in «Checklist documentale, allegati e output» e «Formati e limiti di caricamento» |
| SEQ-D03 | OCR/conversioni server-side con un solo job pesante                                                                          |
| SEQ-D04 | Ogni dato mostra fonte, pagina, metodo e affidabilità                                                                        |
| SEQ-D05 | Correzioni manuali autorevoli e non sovrascritte                                                                             |
| SEQ-D06 | Codex su comando, tramite subscription, senza API fallback                                                                   |
| SEQ-D07 | Output Codex strutturato e validato; interpretazioni sempre revisionabili                                                    |
| SEQ-D08 | Benchmark con zero errori critici accettati silenziosamente                                                                  |

## Dominio e DIZ

| ID      | Requisito                                                                                                                                                                                       |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEQ-F01 | Motore deterministico di devoluzione con conferma finale umana                                                                                                                                  |
| SEQ-F02 | Motore completo di calcolo e confronto con SuccessioniOnLine                                                                                                                                    |
| SEQ-F03 | Regole e catalogo ministeriale versionati per modello/data                                                                                                                                      |
| SEQ-F04 | Checklist dinamica, allegati e output operativi                                                                                                                                                 |
| SEQ-F05 | Procedimento unico per defunto con dichiarazioni successive separate                                                                                                                            |
| SEQ-Z01 | Import DIZ crea o riallinea la pratica                                                                                                                                                          |
| SEQ-Z02 | Writer DIZ e round-trip qualificato con SuccessioniOnLine su macOS; portabilità del formato verificata deterministicamente; disponibilità ed esecuzione del collaudo Windows finale facoltative |
| SEQ-Z03 | Preservazione di allegati e blocchi sconosciuti                                                                                                                                                 |
| SEQ-Z04 | Confronto a tre vie soltanto nel round-trip DIZ                                                                                                                                                 |
| SEQ-Z05 | Fascicolo conclusivo con telematico, stampa, ricevute ed esiti                                                                                                                                  |

## UX, offline e dati

| ID      | Requisito                                                                |
| ------- | ------------------------------------------------------------------------ |
| SEQ-U01 | Dashboard operativa e creazione da documenti, DIZ o compilazione guidata |
| SEQ-U02 | Doppia vista: oggetti reali e quadri ministeriali                        |
| SEQ-U03 | Workspace affiancato campo/fonte e coda `Da verificare`                  |
| SEQ-U04 | Autosave e snapshot soltanto nei momenti previsti                        |
| SEQ-U05 | Ricerca globale FTS5                                                     |
| SEQ-U06 | Offline per pratiche selezionate con modifica e allegati in coda         |
| SEQ-U07 | Conflitto offline semplice senza merge universale                        |
| SEQ-U08 | Anagrafiche e beni condivisi con snapshot storici                        |

## Sicurezza, operations e engineering

| ID      | Requisito                                                                                                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| SEQ-S01 | Account proprietario con username non sensibile alle maiuscole, password e passkey facoltativa                                       |
| SEQ-S02 | HTTPS, cookie sicuri, rate limiting, CSRF e segreti fuori da Git                                                                     |
| SEQ-S03 | Separazione forte da Hub Fatture                                                                                                     |
| SEQ-S04 | Backup manuale, tre snapshot tecnici e restore CLI                                                                                   |
| SEQ-S05 | Logging ordinario e diagnostica opt-in temporanea                                                                                    |
| SEQ-E01 | SvelteKit/Node/TypeScript, processo unico, SQLite e filesystem                                                                       |
| SEQ-E02 | Oxfmt/Oxlint senza Prettier/ESLint diretti                                                                                           |
| SEQ-E03 | Unica istanza VPS; checkout separato dal runtime; CI, release approvata e deploy automatico in manutenzione |
| SEQ-E04 | Dependabot settimanale secondo la policy confermata                                                                                  |
| SEQ-E05 | Semantic Versioning, rollback e compatibilità SuccessioniOnLine versionata                                                           |

---

# 60. Decisioni condizionate dagli spike

| Decisione                                                | Quando si apre                                                                      |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| DIZ puro TypeScript oppure componente locale/Java minimo | `TG-DIZ` non dimostra un writer affidabile                                          |
| Rimozione del compatibility layer TypeScript             | tooling Svelte pienamente compatibile con il compilatore primario                   |
| Integrazione Codex disabilitata stabilmente sull'istanza | login headless/subscription non risulta mantenibile                                 |
| Limitazione ulteriore dell'offline                       | `TG-OFFLINE` evidenzia limiti reali di Safari/Chromium                              |
| Modulo/librerie finali per DOCX/XLSX/PDF                 | implementazione degli output definiti in «Checklist documentale, allegati e output» |
| Stop legale sull'analisi DIZ                             | l'interoperabilità richiede attività oltre il perimetro strettamente necessario     |

La chiusura richiede una prova e, se la scelta è difficile da invertire, un ADR.

---

# 61. Decisioni esplicitamente sostituite

| Decisione superata                                       | Decisione corrente                                                                                                                                                                        |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| app desktop Python/PySide o Tauri/Rust                   | web app pura SvelteKit                                                                                                                                                                    |
| architettura web + desktop ordinaria                     | una sola web app; componente locale solo fallback DIZ                                                                                                                                     |
| app nativa mobile o PWA installabile                     | browser normale                                                                                                                                                                           |
| OneDrive/Dropbox/iCloud come sincronizzazione            | backend e sync propri                                                                                                                                                                     |
| React/Next/Fastify                                       | SvelteKit unico framework                                                                                                                                                                 |
| PostgreSQL/Object Storage operativo                      | SQLite + filesystem VPS                                                                                                                                                                   |
| OPFS/Dexie                                               | IndexedDB Blob tramite `idb`                                                                                                                                                              |
| Redis/BullMQ/ORM                                         | coda SQLite e SQL diretto                                                                                                                                                                 |
| Python/Go/Rust generalizzati                             | TypeScript principale; eccezione DIZ solo dopo prova                                                                                                                                      |
| due processi `web` + `worker`                            | un solo processo/container con processi figli                                                                                                                                             |
| API OpenAI o modello locale fallback                     | subscription Codex senza fallback                                                                                                                                                         |
| Codex avviato su ogni upload                             | Codex su comando                                                                                                                                                                          |
| rete Codex sempre disponibile                            | analisi pratica senza rete; ricerca normativa esplicita online                                                                                                                            |
| Prettier/ESLint                                          | Oxfmt/Oxlint diretti                                                                                                                                                                      |
| magic link, TOTP, recovery code e Turnstile              | username + password, passkey facoltativa e reset VPS                                                                                                                                      |
| cifratura applicativa dati/cache                         | hardening infrastrutturale e protezione OS/browser                                                                                                                                        |
| backup automatico/cifrato                                | backup manuale non cifrato                                                                                                                                                                |
| restore completo dall'interfaccia                        | restore CLI da runbook                                                                                                                                                                    |
| replica offline dell'intero archivio                     | offline per pratiche selezionate                                                                                                                                                          |
| merge universale campo-per-campo                         | scelta server o copia locale; three-way solo DIZ                                                                                                                                          |
| branch di disaster recovery nel browser                  | export locale e reimport manuale                                                                                                                                                          |
| audit forense di ogni clic                               | audit essenziale del fascicolo + log tecnici                                                                                                                                              |
| diagnostica conservata indefinitamente                   | opt-in, 30 giorni salvo conservazione manuale                                                                                                                                             |
| agenda completa e reminder personalizzabili              | sole scadenze essenziali e checklist                                                                                                                                                      |
| ricerca semantica                                        | FTS5 deterministica                                                                                                                                                                       |
| notifiche browser/e-mail operative                       | notifiche interne                                                                                                                                                                         |
| ambienti Development, Staging e Production separati      | unica istanza VPS con checkout, runtime, dati e copie temporanee separati                                                                                                                 |
| esecuzione diretta della working tree sui dati operativi | release approvata, modalità manutenzione e copie temporanee per le prove rischiose                                                                                                        |
| deploy a ogni merge                                      | `Pubblica` su modifica runtime e release approvata, poi deploy automatico; governance esclusa e prima attivazione separata                                                                |
| Successioni Web                                          | non utilizzabile per assenza frequente di delega                                                                                                                                          |
| `.suc` come formato modificabile                         | `.diz` come file di lavoro; telematico separato                                                                                                                                           |
| DIZ solo export                                          | round-trip completo                                                                                                                                                                       |
| collaudo DIZ obbligatorio su macOS e Windows             | qualificazione DIZ su macOS con test deterministici di portabilità; disponibilità ed esecuzione del collaudo Windows finale facoltative, senza rendere advisory un difetto DIZ confermato |
| app si ferma al DIZ                                      | fascicolo completo fino agli esiti                                                                                                                                                        |
| tutto AI                                                 | deterministic-first, AI-assisted                                                                                                                                                          |

---

# 62. Quality bar finale

La release stabile iniziale di Sequent è pronta quando:

1. `TG-COMPLIANCE` e `TG-DIZ` sono qualificati;
2. ogni dato critico mostra la provenienza e non viene accettato erroneamente in silenzio;
3. devoluzione e interpretazioni richiedono conferma umana;
4. calcoli e regole sono versionati e confrontati con SuccessioniOnLine;
5. originali e dichiarazioni presentate restano integri;
6. le divergenze ufficiali non vengono nascoste;
7. offline per pratiche selezionate non perde modifiche nei casi testati;
8. backup manuale e restore CLI sono provati;
9. Codex può mancare senza bloccare il prodotto;
10. Sequent e Hub Fatture restano isolate;
11. browser e piattaforme target superano la matrice; il supporto Chrome/Edge su Windows resta obbligatorio, mentre SuccessioniOnLine su Windows è escluso dalla matrice bloccante;
12. catalogo ministeriale e output coprono integralmente il perimetro del pacchetto ufficiale corrente;
13. la prima pratica reale parallela è riconciliata;
14. non esistono blocker su dati, autenticazione o DIZ;
15. Master Plan, source manifest, catalogo, contratti essenziali e runbook consentono a Codex di mantenere il sistema senza questa chat;
16. allegati e fornitura rispettano i limiti ufficiali e il controllo Agenzia/Sogei è superato;
17. ogni regola eseguibile ha una provenienza ufficiale verificabile e nessun elemento rilevante resta `unresolved`;
18. le pratiche fuori perimetro telematico sono bloccate e il ciclo ricevute/volture è verificato con fixture ufficiali.

Se a sviluppo concluso è disponibile un ambiente Windows, il round-trip con SuccessioniOnLine può essere ripetuto come collaudo facoltativo. La mancata esecuzione del collaudo Windows non blocca la release; un problema esclusivamente ambientale viene registrato come osservazione advisory. Una divergenza DIZ riproducibile e confermata blocca l'output interessato secondo i criteri ordinari.

---

# 63. Fonti ufficiali vincolanti e riferimenti tecnici

## Pacchetto Agenzia delle Entrate

Le fonti identificate dal manifest macchina sono incorporate nel progetto tramite catalogo e test. Titoli, date, file, stato e autorità di ogni `SRC-*` non vengono duplicati qui; si leggono da `src/domain/official-catalog/source-manifest.json`.

Il catalogo distingue sei famiglie, senza metterle sullo stesso piano:

1. modello, istruzioni, specifiche e XSD;
2. norme, testi vigenti, correttivi e decisioni vincolanti;
3. provvedimenti, circolari, risoluzioni e codici di pagamento;
4. valori annuali come interesse legale e coefficienti;
5. materiale operativo come controllo ufficiale, guida web, ricevute e archivi territoriali;
6. programmi, moduli di controllo, depositi di distribuzione e manuali ufficiali.

Vincoli espressamente recepiti:

- una dichiarazione non conforme alle specifiche viene scartata;
- la fornitura contiene una sola dichiarazione ed è XML 1.0 UTF-8 SUC13;
- la dimensione complessiva non supera 40 MB compressi;
- gli allegati sono PDF/A-1a/1b oppure TIF/TIFF conforme, massimo 5 MB ciascuno;
- i codici fiscali devono essere formalmente corretti, fermo restando che soltanto l'accoglimento ufficiale verifica la registrazione in Anagrafe Tributaria;
- il controllo con il software ufficiale Agenzia/Sogei è obbligatorio prima della trasmissione;
- frontespizio e quadri visibili sono quelli del modello ufficiale;
- regole generali, documenti, termini, volture, ricevute, agevolazioni, riduzioni e devoluzione derivano dai Fascicoli e dagli overlay correnti;
- la struttura tecnica è validata direttamente sugli XSD ufficiali e non ricostruita dal PDF;
- il procedimento di autoliquidazione, le grandezze intermedie e le formule di calcolo derivano dalla guida ufficiale `SRC-10` e diventano golden test;
- le regole giuridiche e i valori numerici dipendenti dal tempo sono selezionati dalle fonti normative e annuali del periodo, non dall’ultima fonte disponibile;
- i chiarimenti dell’Agenzia guidano l’interpretazione operativa senza prevalere sulla legge;
- la versione del controllo e gli archivi territoriali sono riletti dai servizi ufficiali correnti prima del flusso ufficiale;
- i programmi ufficiali conservati nel bundle evitano download ripetuti, ma non sostituiscono il controllo della versione corrente sul canale vivo;
- gli artefatti superati sono usati soltanto per dimostrare la corretta migrazione e non possono governare nuove dichiarazioni.

I link pubblici dell'Agenzia servono a rilevare aggiornamenti e a riacquisire le fonti; non modificano il ruleset finché non viene creato e approvato un nuovo bundle.

## OpenAI

- Codex SDK TypeScript;
- Codex CLI;
- autenticazione ChatGPT;
- configurazione e sandbox;
- output strutturati;
- gestione dei thread;
- policy della subscription;

## Web platform

- Svelte e SvelteKit;
- Service Worker;
- IndexedDB;
- StorageManager/persist;
- WebAuthn;
- File API;
- browser storage quotas;
- PDF.js.

## Runtime e dati

- Node.js release policy;
- TypeScript e compatibility tooling;
- SQLite, WAL, Online Backup API e FTS5;
- better-sqlite3;
- Zod;
- Oxc/Oxlint/Oxfmt;
- Vitest;
- Playwright.

## Documenti

- Tesseract;
- OCRmyPDF;
- Poppler;
- ImageMagick;
- LibreOffice;
- formati Office/OpenDocument;
- strumenti XML/XSD.

## Infrastruttura

- Oracle Cloud Always Free, Health Checks, Monitoring e Notifications;
- Ubuntu 24.04 LTS;
- Docker e Compose;
- Caddy;
- Dynu;
- Tailscale;
- GitHub Actions e Dependabot.

## Link iniziali da qualificare

- Agenzia delle Entrate — software di compilazione: <https://www.agenziaentrate.gov.it/portale/schede/dichiarazioni/dichiarazione-di-successione/sw-comp-dichiarazione-successioni-telematiche>
- Agenzia delle Entrate — specifiche tecniche: <https://www.agenziaentrate.gov.it/portale/schede/dichiarazioni/dichiarazione-di-successione/specifiche-tecniche-dichiarazione-di-successione>
- Agenzia delle Entrate — provvedimento del 13 febbraio 2025: <https://www.agenziaentrate.gov.it/portale/provvedimento-del-13-febbraio-2025>
- Normattiva — D.Lgs. 346/1990 vigente: <https://www.normattiva.it/atto/caricaDettaglioAtto?atto.articolo.numero=0&atto.codiceRedazionale=090G0384&atto.dataPubblicazioneGazzetta=1990-11-27&tipoDettaglio=vigente>
- Gazzetta Ufficiale — ricerca e pubblicazioni ufficiali: <https://www.gazzettaufficiale.it/>
- Agenzia delle Entrate — Archivio Comuni e Stati esteri: <https://arcom.agenziaentrate.gov.it/CitizenArCom/>
- OpenAI Codex SDK: <https://developers.openai.com/codex/codex-sdk>
- OpenAI Codex authentication: <https://developers.openai.com/codex/auth>
- SvelteKit: <https://svelte.dev/docs/kit>
- Node.js releases: <https://nodejs.org/en/about/previous-releases>
- TypeScript: <https://www.typescriptlang.org/docs/>
- SQLite: <https://www.sqlite.org/docs.html>
- SQLite WAL: <https://www.sqlite.org/wal.html>
- SQLite Online Backup API: <https://www.sqlite.org/backup.html>
- Normattiva — interoperabilità/decompilazione: <https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1941-04-22;633~art64quater>
- W3C WebAuthn: <https://www.w3.org/TR/webauthn-3/>
- MDN IndexedDB: <https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API>
- MDN Service Worker: <https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API>
- OCRmyPDF: <https://ocrmypdf.readthedocs.io/>
- Tesseract: <https://tesseract-ocr.github.io/>
- ImageMagick: <https://imagemagick.org/>
- LibreOffice headless/documentation: <https://help.libreoffice.org/>
- Oxc toolchain: <https://oxc.rs/>
- Oxfmt language support: <https://oxc.rs/docs/guide/usage/formatter/language-support>
- OCI Health Checks: <https://docs.oracle.com/en-us/iaas/Content/HealthChecks/home.htm>
- Caddy: <https://caddyserver.com/docs/>
- Tailscale: <https://tailscale.com/kb>
- Oracle Cloud Free Tier: <https://docs.oracle.com/iaas/Content/FreeTier/freetier.htm>

## Principio di verifica

Il pacchetto ufficiale completo identificato dal manifest macchina è la baseline vincolante iniziale. Le versioni esatte delle altre dipendenze e capacità vanno confermate sulla documentazione ufficiale e nell'ambiente reale. Nessuna citazione secondaria sostituisce il catalogo derivato, i test SUC13, il round-trip DIZ o il controllo di SuccessioniOnLine.

---

# 64. Approvazione e handover

## 64.1 Stato

Questo Master Plan rappresenta lo stato canonico corrente di Sequent. Non è provvisorio e non ha una versione autonoma: la cronologia Git è lo storico.

L'architettura operativa approvata è VPS-first e single-instance: Codex sviluppa direttamente sulla stessa VPS che ospita Sequent, ma il checkout di lavoro, la release attiva e i dati operativi restano separati. Non vengono creati ambienti Development, Staging e Production permanenti.

## 64.2 Istruzione a Codex

Codex deve:

1. ricevere dall'owner un unico ZIP e non delegare all'owner trasferimenti, estrazioni, directory, repository o comandi di bootstrap;
2. verificare il pacchetto localmente, individuare il target amministrativo e svolgere un preflight remoto in sola lettura;
3. chiedere una sola autorizzazione prima delle prime scritture remote e poi trasferire autonomamente il pacchetto;
4. eseguire il bootstrap incluso, creare `/opt/sequent/` e lavorare nel checkout `/opt/sequent/repo/`;
5. creare il repository GitHub pubblico quando autorizzato, chiedendo all'owner soltanto l'eventuale autenticazione interattiva;
6. non creare ambienti Development, Staging o Production separati;
7. predisporre e rispettare la separazione fra `repo/`, `runtime/`, `data/`, `private/`, `releases/`, `snapshots/` e `tmp/`;
8. seguire la matrice tematica definita in «Regola di lettura per gli agenti»;
9. verificare prima di tutto tutti gli artefatti, l'albero XSD e i digest dichiarati dai manifest sia prima sia dopo il trasferimento;
10. non iniziare dalla UI completa né pubblicare il servizio durante il bootstrap senza approvazione;
11. preparare repository, source manifest, catalog pipeline e DIZ Lab direttamente sulla VPS;
12. chiudere `TG-COMPLIANCE` e `TG-DIZ` prima delle funzioni che ne dipendono;
13. fermarsi al Decision Gate se il writer DIZ non è affidabile o una fonte è irrisolta;
14. mantenere PDF, ZIP/XSD ufficiali e dati reali fuori dal repository pubblico;
15. non eseguire la working tree come servizio live e non usare i dati reali come fixture;
16. provare migrazioni e operazioni rischiose su copie temporanee isolate;
17. non copiare regole a mano in componenti isolati: generare/consumare il catalogo ufficiale;
18. rispettare la sequenza definita nel capitolo «Milestone di implementazione»;
19. creare ADR soltanto per scelte stabili;
20. aggiornare insieme codice, catalogo, test e documentazione essenziale.

## 64.3 Primo messaggio operativo consigliato

> Apri l'unico ZIP allegato, leggi `START_HERE.md` e `CODEX_START_PROMPT.md` e gestisci tu verifica, individuazione della VPS, preflight, trasferimento, bootstrap `/opt/sequent/`, inizializzazione Git e creazione del repository GitHub. Non delegare comandi manuali all'owner: chiedi soltanto autenticazioni, selezioni o autorizzazioni indispensabili. Lavora poi direttamente sulla VPS nella singola installazione Sequent, senza ambienti Development, Staging o Production separati. Versiona nel repository gli artefatti ministeriali pubblici dichiarati e l'albero XSD, mantenendo fuori da Git dati reali, documenti cliente e segreti; ripeti le verifiche sul server, compila il main schema e prepara catalog pipeline e DIZ Lab. Non pubblicare ancora il servizio e non eseguire la working tree sui dati operativi. Produci il piano eseguibile di `TG-COMPLIANCE` e `TG-DIZ`, con coverage, golden test di `SRC-10`, fixture sintetiche, copie temporanee per prove rischiose, criteri di arresto e nessuna regola completata per inferenza.

## 64.4 Modifiche future

Una modifica sostanziale indica decisione, motivazione, impatto e approvazione owner. L'ADR è necessario solo quando la scelta è difficile da invertire.

## 64.5 Owner

- **Owner:** Matteo
- **Prodotto:** Sequent
- **Stato operativo:** determinato da HEAD, gate e configurazione privata; non duplicato nel piano
