# Sequent

Sequent è un assistente operativo per dichiarazioni di successione. È un prodotto deterministico-first: rende visibili fonti e divergenze, conserva gli originali e mantiene il controllo professionale umano.

Questo repository pubblico contiene esclusivamente codice, documentazione, cataloghi derivati e fixture sintetiche. Le fonti ufficiali dichiarate dal manifest, gli XSD originali, i DIZ reali e i documenti dei clienti restano fuori da Git in `/opt/sequent/private/`.

## Piano e operatività

Il piano canonico e la sequenza di implementazione sono in [`docs/MASTER_PLAN.md`](docs/MASTER_PLAN.md). Lo stato effettivo del software deriva dall'HEAD corrente, dai gate e dalla configurazione privata dell'istanza: non viene duplicato in questo README.

La configurazione del repository, i required checks e la procedura di review Codex exact-HEAD sono descritti nel [`runbook GitHub`](docs/runbooks/github.md).

## Verifiche fondamentali

Sulla VPS canonica:

```bash
cd /opt/sequent/repo
scripts/vps/with-node.sh npm ci
scripts/vps/with-node.sh npm run verify:public
scripts/vps/with-node.sh npm run verify:sources
scripts/vps/preflight.sh
```

`verify:sources` legge per default `/opt/sequent/private/official-sources/`, controlla manifest, dimensioni, pagine, hash, sicurezza dello ZIP, XSD e compilazione offline dello schema principale.

## Sviluppo applicativo

La fondazione SvelteKit usa dati locali sintetici in `.local-data/` per impostazione predefinita:

```bash
npm ci
npm run dev
```

`SEQUENT_DATA_DIR` seleziona una directory isolata. Non deve puntare ai dati operativi dal checkout. I gate applicativi sono inclusi in `npm run verify:public`; l’E2E browser è separato in `npm run test:e2e`.

## Confini

- checkout: `/opt/sequent/repo/`;
- fonti e corpus privati: `/opt/sequent/private/`;
- dati operativi: `/opt/sequent/data/`;
- runtime futuro: `/opt/sequent/runtime/`;
- prove rischiose: copie isolate in `/opt/sequent/tmp/`.

Nessuna licenza è concessa in questa fase.
