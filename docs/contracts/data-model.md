# Contratto del modello dati

Il modello canonico corrente è qualificato per l’ambito dichiarato dal catalogo e dal source bundle registrato. Una nuova fonte, una divergenza o un campo privo di provenienza riapre `TG-COMPLIANCE` e blocca l’output interessato. Ogni campo qualificato registra identificativo stabile, etichetta, Quadro, percorso XSD, tipo, cardinalità, regole, periodo di efficacia, provenienza e livello di supporto.

Nessun componente dell’interfaccia può introdurre costanti fiscali o corrispondenze non presenti nel catalogo. Un aggiornamento delle fonti produce una nuova versione esplicita e rimette i dati precedenti in controllo quando necessario.

## Fondazione persistente

La pratica rappresenta il procedimento e può contenere più dichiarazioni ordinate. Ogni dichiarazione resta un JSON versionato autonomo: la separazione è strutturale fin dalla fondazione, anche se l’interfaccia iniziale crea soltanto la prima dichiarazione. SQLite contiene identità owner, sessioni, indice dei procedimenti, dichiarazioni, documenti e coda persistente. Ogni salvataggio della dichiarazione usa una revisione attesa: una revisione server diversa produce `REVISION_CONFLICT` e non sovrascrive silenziosamente lo stato più recente.

I documenti collegano metadati e SHA-256 a un blob immutabile nel filesystem. La scrittura passa da un temporaneo sullo stesso filesystem, `fsync`, hash e collegamento atomico che non sovrascrive un blob già presente. Solo dopo la persistenza dei byte, un’unica transazione collega o crea la pratica, registra il documento e accoda la verifica; un fallimento precedente al commit non lascia una pratica vuota. I temporanei di upload sopravvissuti a un riavvio vengono rimossi dopo un periodo di sicurezza. Le attività equivalenti sono deduplicate da tipo e impronta dell’input; un’attività rimasta in corso al riavvio viene interrotta e torna in coda soltanto entro il limite di tentativi.

## Dominio della pratica

Soggetti, beni e passività appartengono alla pratica e vengono registrati una sola volta. Ogni dichiarazione conserva invece le proprie posizioni nei Quadri, i valori, i controlli e le conferme. Una dichiarazione successiva nasce da una copia controllata della precedente senza unire le revisioni.

La devoluzione è salvata come proposta completa per bene e beneficiario. Quote non valide, beni non attribuiti o somme diverse dall’intero bloccano la conferma. La conferma professionale identifica lo scenario autorevole e rende possibile il calcolo.

Ogni calcolo conserva input, versione delle regole, valori intermedi da `QE` a `ISN`, problemi e impronta deterministica. Un calcolo privo dei dati necessari resta bloccato; soltanto un calcolo senza problemi può essere confermato. Una nuova conferma di devoluzione rende non più corrente il calcolo precedente.

La checklist documentale viene derivata dai dati della dichiarazione, conserva le decisioni già prese e si salva in un’unica transazione. Le deroghe richiedono sempre una motivazione.

## Flusso ufficiale

Ogni import o reimport DIZ crea nello stesso commit logico uno snapshot della dichiarazione. Gli artefatti ufficiali sono blob immutabili distinti per dichiarazione e tipo; cicli export/reimport separati conservano revisione di base, campi DIZ, impronta opaca, report di conformità, confronto a tre vie e risoluzione. Per dichiarazione può esistere un solo ciclo non risolto. Le conferme operative prive di file, ammesse soltanto quando la seconda ricevuta non è ottenibile, sono eventi distinti con motivazione ed estremi ufficiali. La prima presentazione e la prima chiusura producono snapshot dedicati. Gli override dello stato sono record append-only auditati e non possono elevare lo stato oltre l’evidenza acquisita. Telematico, diagnostici, ricevute, quietanze ed esiti non vengono sovrascritti da invii successivi.
