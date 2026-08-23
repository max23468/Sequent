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

Decidi autonomamente naming, formattazione e default tecnici reversibili. Fermati soltanto per azioni distruttive, deploy, release o letture materialmente diverse della richiesta.
