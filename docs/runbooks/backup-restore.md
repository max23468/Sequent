# Backup e ripristino di base

Il backup di base crea uno snapshot consistente di SQLite tramite Online Backup API e racchiude il content-addressed blob store in un unico archivio ZIP non cifrato. Il manifest interno contiene dimensione e SHA-256 di ogni file. La verifica estrae il pacchetto in una directory temporanea, rifiuta percorsi non sicuri e link simbolici e copre anche derivati documentali, allegati preparati, DIZ, telematici, ricevute ed esiti ufficiali referenziati dal database. Account, password hash, sessioni e segreti sono esclusi; il comando qualifica snapshot, inventario e verificabilità su dati sintetici o su una copia temporanea autorizzata.

Nell’istanza applicativa l’owner usa **Impostazioni → Backup manuale**. Sequent apre una breve modalità manutenzione, sospende l’avvio delle attività accodate, attende per un tempo limitato l’eventuale attività già in corso, crea la copia sotto la directory dati, la rilegge integralmente e rimuove sempre il marker di manutenzione. Se l’attività corrente non termina entro la finestra prevista, il backup si arresta senza lasciare il marker. L’interfaccia mostra un promemoria dopo 7 giorni e un avviso più evidente dopo 14 giorni.

Nel checkout, con una directory dati non operativa:

```bash
SEQUENT_DATA_DIR=/percorso/copia-isolata npm run admin:backup -- /percorso/destinazione
```

Il comando stampa il percorso del file `.zip` soltanto dopo averlo riaperto e verificato integralmente. Non eseguire il comando dal checkout contro `/opt/sequent/data`: sul runtime operativo il backup viene orchestrato dalla release approvata e dalla modalità manutenzione.

## Ripristino

Il ripristino verifica prima numero di entry, dimensione espansa massima di 2 GiB, rapporto di compressione e spazio disponibile; estrae poi ogni file in sequenza contando i byte effettivi e rimuove il temporaneo al primo errore. Manifest, inventario, hash, integrità SQLite e blob vengono verificati prima di modificare la destinazione. La sorgente deve trovarsi fuori dalla directory dati. La prima prova va eseguita su una directory isolata:

```bash
npm run admin:restore -- --backup /percorso/backup-verificato --data-dir /opt/sequent/tmp/restore-prova
```

Se la destinazione esiste il comando si ferma. `--replace` è l’autorizzazione esplicita a sostituirla e rinomina prima la base esistente in una directory sorella `.sequent-before-restore-*`, che resta disponibile per il rollback:

```bash
npm run admin:restore -- --backup /percorso/backup-verificato --data-dir /percorso/dati --replace
```

Il backup non contiene le credenziali. Dopo un ripristino verificato, ricreare l’owner con il comando descritto nel runbook di attivazione. Arrestare il runtime e accertarsi che nessun processo abbia la directory dati aperta prima di un restore operativo; la presenza del comando non autorizza il ripristino di Production.
