# Istruzioni operative per gli agenti

Rispondi sempre in italiano, con accenti e apostrofi corretti. Non sovrascrivere modifiche non tue. Non mantenere retrocompatibilità o implementazioni legacy: non esistono consumatori esterni da preservare.

Prima di lavorare, leggi integralmente in `docs/MASTER_PLAN.md` i capitoli «Come usare questo documento», «Definizione e principi del prodotto», «Scope e non-scope iniziale», i Technical Gate pertinenti e le decisioni esplicitamente sostituite. Per interventi sulla VPS, runtime o deploy leggi anche i capitoli su infrastruttura, separazione degli ambienti, workflow Git e release. Per DIZ leggi sempre «Interoperabilità DIZ» e «Round-trip con SuccessioniOnLine». Per dominio e fonti ufficiali leggi anche «Motore di calcolo» e «Motore normativo e conformità ufficiale».

Regole inderogabili:

- `docs/MASTER_PLAN.md` è la fonte canonica del prodotto.
- Le fonti ufficiali pubbliche risiedono in `private/official-sources/` e sono versionate insieme al repository; dati reali, documenti cliente e segreti restano esclusi da Git.
- Non dedurre campi, formule, codici o controlli per analogia; una divergenza irrisolta è un blocker esplicito.
- Il checkout `/opt/sequent/repo/`, il runtime, i dati e le copie temporanee restano separati.
- Non eseguire la working tree sui dati operativi e non usare dati reali come fixture.
- Non modificare Caddy, Dynu, firewall o Hub Fatture senza autorizzazione specifica.
- Sul Mac ogni verifica dell'immagine ARM64 usa `npm run image:local`; non creare direttamente tag locali Sequent, perché il wrapper conserva soltanto il tag canonico e la revisione corrente.
- Sulla VPS ogni build Docker temporanea usa `scripts/vps/with-temporary-docker-image.sh`; non lasciare tag, container o layer di prova fuori dal wrapper.
- Il bootstrap e i gate preliminari non autorizzano pubblicazione o attivazione di servizi.
- Ogni bug fiscale, DIZ, di persistenza o di separazione dei dati produce una regressione minima.

## Significato di `Pubblica`

Quando il proprietario, riferendosi alla repository o alla modifica corrente, dice `Pubblica` o chiede in modo affermativo e inequivocabile di pubblicare, autorizza l'intero ciclo tecnico applicabile. Domande, ipotesi, pianificazioni e negazioni non costituiscono autorizzazione. L'agente non si ferma a stati intermedi e completa preparazione e verifiche, branch e commit, versione e changelog quando richiesti, push, pull request, gate bloccanti, review Codex exact-HEAD, squash merge, candidata di release, tag e GitHub Release quando previsti, deploy tecnico e verifica live quando applicabili, pulizia e rilettura finale.

`main` resta permanente e protetto. Prima della pull request l'HEAD deve essere coerente e avere superato i gate locali proporzionati. L'impatto operativo si valuta sul diff cumulativo fra l'ultima release distribuita con successo e il candidato finale, non sulla sola ultima pull request. Modifiche esclusivamente documentali, di test o di governance non richiedono immagine, release o deploy; più modifiche runtime già assorbite in `main` vengono qualificate e distribuite una sola volta sul candidato finale.

Per una modifica runtime, il ciclo `Pubblica` include la candidata completa. Se esiste già una release attiva e il workflow Production è qualificato, include anche deploy, readback live e GitHub Release senza una seconda conferma. Prima della prima attivazione stabile si ferma invece alla candidata qualificata: attivazione iniziale, hostname pubblico, Caddy, Dynu e firewall richiedono una richiesta esplicita separata. Il bootstrap o la mera presenza di un artefatto non rendono il runtime attivo.

Quando richiesti dalla policy di versione, bump e voce di changelog appartengono alla stessa pull request della modifica runtime. Non fondere consapevolmente una modifica runtime incompleta per aprire poi una pull request solo di release, salvo deroga esplicita del proprietario.

Non aggiungere dati reali, documenti cliente, segreti o artefatti privati al repository pubblico. Le sole fonti ministeriali pubbliche dichiarate dal manifest appartengono invece a `private/official-sources/`. `Pubblica` non autorizza invii telematici, uso di pratiche reali, modifiche fiscali non qualificate, attivazione iniziale del servizio o cambiamenti a Caddy, Dynu, firewall e Hub Fatture. Gli aggiornamenti automatici restano limitati alla proposta di pull request: runtime, toolchain, Codex, SQLite, OCR, Oxfmt, Oxlint, DIZ e versioni major richiedono valutazione deliberata.

La pulizia finale rimuove soltanto branch e worktree temporanei creati nel ciclo corrente e già assorbiti. Se un passaggio non è applicabile, dichiaralo e prosegui con gli altri. Non dichiarare `pubblicato` finché tutti i passaggi applicabili e la rilettura finale di PR, check, candidata, eventuale deploy/release e stato Git non sono completi.

## Gate dei commenti Codex

- Non eseguire il merge finché tutti i required checks non sono verdi e tutte le conversazioni non sono risolte. Dopo il merge rileggi `main`, elimina il branch temporaneo e verifica che checkout e VPS canonica siano puliti, quando la VPS rientra nello scope.

Decidi autonomamente naming, formattazione e default tecnici reversibili. Fermati soltanto per azioni distruttive, prima attivazione, deploy o release non già autorizzati da `Pubblica`, o letture materialmente diverse della richiesta.
