# Sicurezza

Non aprire issue pubbliche contenenti vulnerabilità, dati personali, documenti fiscali, DIZ, telematici, credenziali o dettagli infrastrutturali sensibili. Contattare privatamente l'owner del repository.

Le fonti ufficiali originali e ogni corpus reale devono restare in `/opt/sequent/private/`. Prima di ogni commit eseguire `npm run verify:public`.

## Policy delle vulnerabilità di dipendenze e immagini

Le scansioni di lockfile e immagini falliscono chiuse se lo scanner non termina correttamente o produce un report assente, ambiguo o non interpretabile. Qualunque vulnerabilità per cui lo scanner dichiara un fix distribuibile blocca la candidata, indipendentemente dalla severità.

Le vulnerabilità senza fix distribuibile, incluse quelle classificate Critical, restano advisory accettate dal proprietario: conteggi, severità e identificativi devono rimanere visibili nell'evidenza e nel riepilogo della candidata fino all'aggiornamento della base o del pacchetto interessato. Questa accettazione non autorizza suppressioni, baseline, `continue-on-error`, riduzione della scansione o esclusione dei pacchetti dal report.
