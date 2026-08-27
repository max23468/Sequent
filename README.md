# Sequent

Sequent è un assistente operativo per dichiarazioni di successione. È un prodotto deterministico-first: rende visibili fonti e divergenze, conserva gli originali e mantiene il controllo professionale umano.

Questo repository pubblico contiene esclusivamente codice, documentazione, cataloghi derivati e fixture sintetiche. Le fonti ufficiali dichiarate dal manifest, gli XSD originali, i DIZ reali e i documenti dei clienti restano fuori da Git in `/opt/sequent/private/`.

## Piano e operatività

Il piano canonico e la sequenza di implementazione sono in [`docs/MASTER_PLAN.md`](docs/MASTER_PLAN.md). Lo stato effettivo del software deriva dall'HEAD corrente, dai gate e dalla configurazione privata dell'istanza: non viene duplicato in questo README.

La configurazione del repository, i required checks e la procedura di review Codex exact-HEAD sono descritti nel [`runbook GitHub`](docs/runbooks/github.md).

Il preflight proporzionato di una pubblicazione GitHub si avvia con `npm run publication:github`. Senza l'opzione esplicita di esecuzione il comando non esegue push, non apre PR e non effettua merge.

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

In `vite dev` Sequent crea, se necessario, un owner sintetico e apre automaticamente una sessione di sviluppo per le sole richieste provenienti dal loopback locale. Non serve quindi inserire la password durante il normale lavoro. Il fallback locale è `SequentSviluppoSicuro2026` e può essere sostituito con `SEQUENT_DEV_PASSWORD`; l’auto-login è escluso dalle build preview e di produzione. Per collaudare manualmente setup e login durante lo sviluppo si può avviare con `SEQUENT_DEV_AUTO_LOGIN=false`.

`SEQUENT_DATA_DIR` seleziona una directory isolata. Non deve puntare ai dati operativi dal checkout. `verify:rapid` copre il preflight documentale, `verify:public` i gate applicativi senza duplicare Svelte Doctor e `verify:publication` aggiunge Doctor ed E2E browser.

La verifica Docker ARM64 locale usa esclusivamente il wrapper con retention integrata:

```bash
npm run image:local
```

Il wrapper interrompe la build se il disco supera l'85% di utilizzo, aggiorna il tag canonico, conserva un solo tag legato alla revisione corrente e rimuove i precedenti tag locali non referenziati da container. Quando il contesto attivo è Colima esegue anche il TRIM del disco virtuale.

Per limitare anche la cache BuildKit indipendente dalle immagini, la sezione `docker` di `~/.colima/default/colima.yaml` usa questa policy:

```yaml
docker:
  builder:
    gc:
      enabled: true
      defaultKeepStorage: 8GB
```

Dopo una modifica alla configurazione, applicarla con `colima stop && colima start` quando non sono in corso build. Il valore è un obiettivo di retention del garbage collector, non un limite rigido alla dimensione del disco virtuale.

## Confini

- checkout: `/opt/sequent/repo/`;
- fonti e corpus privati: `/opt/sequent/private/`;
- dati operativi: `/opt/sequent/data/`;
- runtime futuro: `/opt/sequent/runtime/`;
- prove rischiose: copie isolate in `/opt/sequent/tmp/`.

Nessuna licenza è concessa in questa fase.
