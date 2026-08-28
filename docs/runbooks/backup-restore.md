# Backup e ripristino di base

Il backup di base crea uno snapshot consistente di SQLite tramite Online Backup API e copia il content-addressed blob store in una nuova directory. Il manifest contiene dimensione e SHA-256 di ogni file. Account, password hash, sessioni e segreti sono esclusi; il comando qualifica snapshot, inventario e verificabilità su dati sintetici o su una copia temporanea autorizzata.

Nel checkout, con una directory dati non operativa:

```bash
SEQUENT_DATA_DIR=/percorso/copia-isolata npm run admin:backup -- /percorso/destinazione
```

Il comando stampa il percorso soltanto dopo aver riletto e verificato il manifest. Non eseguire il comando dal checkout contro `/opt/sequent/data`: sul runtime operativo il backup verrà orchestrato dalla release approvata e dalla modalità manutenzione.

## Ripristino

Il ripristino verifica nuovamente manifest, inventario, hash, integrità SQLite e blob prima di modificare la destinazione. La sorgente deve trovarsi fuori dalla directory dati. La prima prova va eseguita su una directory isolata:

```bash
npm run admin:restore -- --backup /percorso/backup-verificato --data-dir /opt/sequent/tmp/restore-prova
```

Se la destinazione esiste il comando si ferma. `--replace` è l’autorizzazione esplicita a sostituirla e rinomina prima la base esistente in una directory sorella `.sequent-before-restore-*`, che resta disponibile per il rollback:

```bash
npm run admin:restore -- --backup /percorso/backup-verificato --data-dir /percorso/dati --replace
```

Il backup non contiene le credenziali. Dopo un ripristino verificato, ricreare l’owner con il comando descritto nel runbook di attivazione. Arrestare il runtime e accertarsi che nessun processo abbia la directory dati aperta prima di un restore operativo; la presenza del comando non autorizza il ripristino di Production.
