# Preparazione applicativa della prima attivazione

Questa procedura prepara i dati applicativi, ma non autorizza né esegue la prima attivazione, il deploy, Dynu, Caddy o il firewall. Va applicata soltanto a un artefatto qualificato e a una finestra autorizzata.

## Configurazione iniziale

In Production Codex e DIZ sono spenti per default. Mantenerli esplicitamente spenti nella configurazione privata del runtime:

```text
SEQUENT_CODEX_ENABLED=false
SEQUENT_DIZ_ENABLED=false
```

Il layout applica globalmente `noindex, nofollow, noarchive` sia via meta tag sia via header `X-Robots-Tag`. Questo completa, ma non sostituisce, autenticazione e regole di accesso del proxy.

## Owner principale

In Production `/setup` non crea account: finché l’owner manca, la web app resta bloccata e richiede questa configurazione amministrativa fuori banda. Il comando accetta lo username come argomento e la password esclusivamente da standard input. Lo username viene confrontato senza distinzione tra maiuscole e minuscole; la password deve avere da 8 a 128 caratteri. Il reset revoca tutte le sessioni e azzera i tentativi di login, senza stampare o salvare la password nel repository:

```bash
read -r -s SEQUENT_NEW_PASSWORD
printf '%s' "$SEQUENT_NEW_PASSWORD" | SEQUENT_DATA_DIR=/percorso/dati npm run admin:reset-owner -- --username NomeUtente
unset SEQUENT_NEW_PASSWORD
```

## Pratica dimostrativa

Il seed crea una sola pratica marcata `ESEMPIO SINTETICO`, con defunto e beneficiario fittizi, un immobile, dati essenziali dei Quadri, devoluzione confermata e calcolo in bozza con gli eventuali controlli ancora da completare. Non contiene documenti o dati cliente ed è idempotente:

```bash
SEQUENT_DATA_DIR=/percorso/dati npm run admin:seed-synthetic
```

Prima di introdurre dati reali, rimuoverla con il comando mirato seguente. Il comando non elimina altre pratiche:

```bash
SEQUENT_DATA_DIR=/percorso/dati npm run admin:seed-synthetic -- --remove
```

## Ordine operativo

1. provare backup e restore su `/opt/sequent/tmp`;
2. creare o resettare l’owner principale;
3. creare la pratica sintetica e verificare login, dashboard, Quadri, devoluzione, calcolo e PDF;
4. creare un backup, verificarlo e copiarlo fuori dalla VPS;
5. rimuovere la pratica sintetica prima del primo dato reale;
6. eseguire un nuovo backup vuoto e verificarne il restore isolato.

Hostname pubblico, HTTPS, firewall e attivazione del servizio restano una fase separata che richiede autorizzazione esplicita.
