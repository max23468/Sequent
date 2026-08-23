# Istruzioni operative per gli agenti

Rispondi sempre in italiano, con accenti e apostrofi corretti. Non sovrascrivere modifiche non tue. Non mantenere retrocompatibilità o implementazioni legacy: non esistono consumatori esterni da preservare.

Prima di lavorare, leggi integralmente la sezione 0, le sezioni 4 e 5, i Technical Gate pertinenti della sezione 55 e le decisioni sostituite della sezione 61 di `docs/MASTER_PLAN.md`. Per interventi sulla VPS, runtime o deploy leggi anche le sezioni 43–46 e 52. Per DIZ leggi sempre le sezioni 23 e 24. Per dominio e fonti ufficiali leggi anche le sezioni 19 e 20.

Regole inderogabili:

- `docs/MASTER_PLAN.md` è la fonte canonica del prodotto.
- Le fonti ufficiali risiedono soltanto in `/opt/sequent/private/official-sources/` e non entrano in Git.
- Non dedurre campi, formule, codici o controlli per analogia; una divergenza irrisolta è un blocker esplicito.
- Il checkout `/opt/sequent/repo/`, il runtime, i dati e le copie temporanee restano separati.
- Non eseguire la working tree sui dati operativi e non usare dati reali come fixture.
- Non modificare Caddy, Dynu, firewall o Hub Fatture senza autorizzazione specifica.
- Non pubblicare né attivare servizi durante M0.
- Ogni bug fiscale, DIZ, di persistenza o di separazione dei dati produce una regressione minima.

## Pubblicazione GitHub

- `main` è permanente e protetto; lavora su un branch breve, usa Conventional Commits e integra soltanto con squash merge.
- Una pubblicazione comprende gate locali, push, pull request, controlli GitHub, review Codex exact-HEAD, merge e rilettura finale di repository, branch e working tree.
- Pubblicare su GitHub non autorizza deploy, release, attivazioni sulla VPS, modifiche DNS o altri cambiamenti di produzione.
- Non aggiungere fonti ufficiali, dati reali, documenti cliente, segreti o artefatti privati al repository pubblico. L'assenza di licenza è intenzionale.
- Gli aggiornamenti automatici restano limitati alla proposta di pull request: runtime, toolchain, Codex, SQLite, OCR, Oxfmt, Oxlint, DIZ e versioni major richiedono valutazione deliberata.

## Gate dei commenti Codex

- La prima review è richiesta automaticamente quando una pull request viene aperta o resa pronta. Dopo ogni nuovo commit sull'HEAD, attendi che i gate locali siano verdi e pubblica un singolo commento top-level contenente esclusivamente `@codex review`.
- Il comando è valido soltanto se esatto e inviato da owner, member o collaborator. Non aggiungere testo, Markdown o spiegazioni nello stesso commento.
- Ogni nuovo commit invalida tutte le evidenze precedenti. Prima del merge verifica che il gate `codex-review` sia verde e che marker, review o commenti inline del bot si riferiscano all'HEAD corrente.
- P0 e P1 bloccano il merge: correggi la causa, aggiungi la regressione minima pertinente, pubblica il nuovo HEAD e richiedi una nuova review.
- P2 e P3 sono advisory soltanto dopo il completamento della review e il periodo di assestamento del gate. Non implementarli senza una richiesta esplicita del proprietario; registrali nel riepilogo finale.
- Limiti d'uso, `could not complete`, `unknown error` e altri errori operativi non sono approvazioni né finding sul codice. Quando il servizio torna disponibile, ripeti il commento esatto sullo stesso HEAD.
- Non eseguire il merge finché tutti i required checks non sono verdi e tutte le conversazioni non sono risolte. Dopo il merge rileggi `main`, elimina il branch temporaneo e verifica che checkout e VPS canonica siano puliti, quando la VPS rientra nello scope.

Decidi autonomamente naming, formattazione e default tecnici reversibili. Fermati soltanto per azioni distruttive, deploy, release o letture materialmente diverse della richiesta.
