# Backup e ripristino di base

Il backup di base crea uno snapshot consistente di SQLite tramite Online Backup API e copia il content-addressed blob store in una nuova directory. Il manifest contiene dimensione e SHA-256 di ogni file. Account, password hash, sessioni e segreti sono esclusi; il comando qualifica snapshot, inventario e verificabilità su dati sintetici o su una copia temporanea autorizzata.

Nel checkout, con una directory dati non operativa:

```bash
SEQUENT_DATA_DIR=/percorso/copia-isolata npm run admin:backup -- /percorso/destinazione
```

Il comando stampa il percorso soltanto dopo aver riletto e verificato il manifest. Non eseguire il comando dal checkout contro `/opt/sequent/data`: sul runtime operativo il backup verrà orchestrato dalla release approvata e dalla modalità manutenzione.

Il restore completo non è ancora productizzato: deve ricreare l’account owner e deve essere provato su `/opt/sequent/tmp`, mai direttamente sui dati operativi.
