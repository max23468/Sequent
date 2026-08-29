# Brand Foundation Sequent

## Direzione approvata

Sequent comunica autorevolezza e rassicurazione con un tono editoriale sobrio. Il simbolo rappresenta una sequenza di quattro moduli che si separano e si ricompongono, senza richiami a lutto, genealogia, bilance o pergamene.

Il riferimento non è una schermata da copiare letteralmente: la tavola definisce marchio, palette, proporzioni e gerarchia; le superfici operative definiscono l’applicazione reale del sistema.

Riferimenti canonici:

- [tavola di marca](references/brand-board.png);
- [Dashboard desktop](references/dashboard-desktop.png);
- [workspace desktop](references/workspace-desktop.png);
- [Dashboard dark](references/dashboard-dark.png);
- [Dashboard mobile](references/dashboard-mobile.png).

## Asset

- `static/brand/sequent-symbol-source.svg`: SVG sorgente, leggibile e modificabile, costruito con quattro geometrie native.
- `static/brand/sequent-symbol.svg`: variante ottimizzata usata dall’interfaccia.
- `static/brand/sequent-symbol-monochrome.svg`: controllo monocromatico.
- `static/brand/sequent-symbol-inverse.svg`: variante bianca per superfici scure.
- `static/favicon.svg`: favicon vettoriale adattiva; il rendering di base resta leggibile anche nei browser che non applicano la media query scura dentro le favicon SVG.
- `static/favicon.ico`: fallback raster multirisoluzione con tile chiara, leggibile indipendentemente dal colore della tab.
- `static/safari-pinned-tab.svg`: maschera monocromatica dedicata alle tab fissate di Safari.
- `static/apple-touch-icon.png`: icona dedicata ai collegamenti salvati sui dispositivi Apple.
- `static/icons/`: icone installabili normali e maskable dichiarate dal web manifest, inclusa una maskable SVG full-bleed per Safari su macOS.
- `static/site.webmanifest`: metadati di installazione dell’app web.

Il wordmark usa Georgia con fallback Times New Roman. Nell’app è testo reale affiancato al simbolo, non testo rasterizzato o incorporato nell’SVG.

## Palette e token

| Ruolo                 | Valore    |
| --------------------- | --------- |
| Navy principale       | `#001E42` |
| Teal funzionale       | `#035A64` |
| Grigio strutturale    | `#C6CCD5` |
| Superficie secondaria | `#E8E7E8` |
| Bianco                | `#FFFEFF` |

Il tema scuro usa fondi grafite neutri. Navy e teal restano dettagli di marca e di stato, senza trasformare l’interfaccia in una modalità blu. I colori non sono mai l’unico segnale di stato.

Il navy è riservato a marchio e titoli editoriali. Testo operativo, righe e valori usano un grafite neutro; metadati e intestazioni secondarie usano il grigio semantico. Il teal identifica azioni, focus e segnali puntuali, evitando una dominante blu nei contenuti dei pannelli.

## Tipografia e icone

- titoli editoriali e wordmark: `Georgia, "Times New Roman", serif`;
- interfaccia: `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
- nessun webfont;
- icone funzionali da `@lucide/svelte`, tratto coerente e senza glifi Unicode sostitutivi.

## Shell e responsive

La navigazione principale è `Dashboard`, `Pratiche`, `Documenti`, `Impostazioni`. Desktop usa una testata orizzontale con ricerca persistente; mobile usa una barra inferiore fissa. La Dashboard mantiene tre aree: `Da verificare`, `Scadenze`, `Pratiche recenti`.

Su mobile:

- `Nuova` resta visibile;
- `Carica documenti` e `Riprendi ultima pratica` entrano in `Azioni rapide`;
- i launcher desktop non compaiono;
- i box scorrono verticalmente senza selettori segmentati o tabelle miniaturizzate.

Il workspace desktop segue `sezioni | contenuto | fonte`. In questa fondazione mostra soltanto titolo, revisione, documenti e stato tecnico reali; le funzioni documentali e fiscali arrivano nelle fasi proprietarie definite dal piano canonico.

## Tema e accessibilità

Il tema segue il sistema e consente override chiaro/scuro persistito localmente. Sono obbligatori HTML semantico, label esplicite, focus visibile, flussi principali da tastiera, contrasto sufficiente, reflow e riduzione del movimento.

Il browser riceve anche il `color-scheme` effettivo e un `theme-color` sincronizzato con il tema applicato, così controlli nativi e chrome compatibile non restano incoerenti quando l’utente forza chiaro o scuro. Il colore di fondo reale di `html` e `body` resta sempre coerente con il tema, così Safari può usare correttamente la superficie della pagina anche quando la propria chrome non applica `theme-color` nello stesso modo degli altri browser.

## Browser, titoli e metadati production

I titoli delle pagine seguono il formato `Contesto · Sequent`; il workspace di una pratica può sostituire il contesto generico con il titolo reale della pratica. Errori e schermate di autenticazione hanno titoli dedicati, così cronologia, tab e switcher del sistema operativo restano riconoscibili.

La favicon primaria è un unico SVG adattivo. Chrome e gli altri browser che applicano `prefers-color-scheme` dentro l’SVG ricevono la resa specifica chiara o scura; Safari dispone invece di un rendering di base con tile opaca e contrasto sufficiente, quindi resta leggibile anche quando WebKit non applica la media query interna. Il `.ico` resta il fallback raster. Safari riceve inoltre `apple-touch-icon`, una maschera dedicata per le tab fissate e una icona maskable SVG full-bleed nel manifest.

L’istanza operativa resta a visibilità limitata: l’hostname non viene promosso né pubblicizzato e chi non conosce l’URL non deve poterlo scoprire attraverso motori di ricerca o superfici SEO. La conoscenza dell’URL non è però un controllo di sicurezza: il login resta il confine di accesso ai contenuti.

L’applicazione privata continua a dichiarare `noindex` sia nei metadati sia tramite header HTTP; crawler, snippet e indicizzazione delle immagini sono disabilitati e `robots.txt` richiede di non esplorare l’istanza. Canonical URL, metadati Open Graph pubblici, sitemap e indicizzazione non vengono anticipati senza un sito effettivamente destinato alla consultazione pubblica. Un eventuale futuro sito pubblico resta una superficie distinta dall’istanza operativa privata.

## Launcher locali

`Desktop Telematico` e `SuccessioniOnLine` sono scorciatoie subordinate, mai funzioni di invio. Gli stati sono `available`, `unsupported`, `unknown`:

- un URI viene aperto soltanto quando è stato configurato e qualificato;
- in assenza di qualificazione il pulsante mostra istruzioni manuali;
- percorsi locali e dati privati non vengono committati;
- i launcher non compaiono su iPhone o iPad.

`Desktop Telematico` resta sempre in apertura manuale finché non viene qualificato e versionato un protocollo browser specifico. `SEQUENT_SUCCESSIONI_ONLINE_URL` accetta soltanto un URI `jnlp:` dopo la prova sui browser supportati; un valore assente o diverso mantiene l’apertura manuale.

## Design lab

`/__design` è disponibile soltanto in sviluppo o nei test esplicitamente abilitati. Usa esclusivamente fixture sintetiche per verificare superfici future, stati pieni, responsive e tema scuro. Non rappresenta capacità operative e non è accessibile nell’istanza normale.
