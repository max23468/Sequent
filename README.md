# Sequent

Sequent è un assistente operativo per dichiarazioni di successione. È un prodotto deterministico-first: rende visibili fonti e divergenze, conserva gli originali e mantiene il controllo professionale umano.

Questo repository pubblico contiene esclusivamente codice, documentazione, cataloghi derivati e fixture sintetiche. Le dieci fonti ufficiali, gli XSD originali, i DIZ reali e i documenti dei clienti restano fuori da Git in `/opt/sequent/private/`.

## Stato

M0 — bootstrap VPS, repository, source bundle e DIZ Lab.

Il servizio non è pubblicato e nessuna funzione applicativa è attiva. Il piano canonico è [`docs/MASTER_PLAN.md`](docs/MASTER_PLAN.md).

La configurazione del repository, i required checks e la procedura di review Codex exact-HEAD sono descritti nel [`runbook GitHub`](docs/runbooks/github.md).

## Verifiche M0

Sulla VPS canonica:

```bash
cd /opt/sequent/repo
scripts/vps/with-node.sh npm ci
scripts/vps/with-node.sh npm run verify:public
scripts/vps/with-node.sh npm run verify:sources
scripts/vps/preflight.sh
```

`verify:sources` legge per default `/opt/sequent/private/official-sources/`, controlla manifest, dimensioni, pagine, hash, sicurezza dello ZIP, XSD e compilazione offline dello schema principale.

## Confini

- checkout: `/opt/sequent/repo/`;
- fonti e corpus privati: `/opt/sequent/private/`;
- dati operativi: `/opt/sequent/data/`;
- runtime futuro: `/opt/sequent/runtime/`;
- prove rischiose: copie isolate in `/opt/sequent/tmp/`.

Nessuna licenza è concessa in questa fase.
