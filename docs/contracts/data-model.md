# Contratto del modello dati

Il modello canonico resta non congelato finché `TG-COMPLIANCE` è aperto. Viene generato e riconciliato a partire da modello visibile, istruzioni, guida di calcolo, XSD e overlay. Ogni campo registra identificativo stabile, label, quadro, percorso XSD, tipo, cardinalità, regole, periodo di efficacia, provenienza e livello di supporto.

`TG-COMPLIANCE` blocca il congelamento del dominio. Nessun componente UI può introdurre costanti fiscali o mapping non presenti nel catalogo.

## Fondazione persistente

La pratica rappresenta il procedimento e può contenere più dichiarazioni ordinate. Ogni dichiarazione resta un JSON versionato autonomo: la separazione è strutturale fin dalla fondazione, anche se l’interfaccia iniziale crea soltanto la prima dichiarazione. SQLite contiene identità owner, sessioni, indice dei procedimenti, dichiarazioni, documenti e coda persistente. Ogni salvataggio della dichiarazione usa una revisione attesa: una revisione server diversa produce `REVISION_CONFLICT` e non sovrascrive silenziosamente lo stato più recente.

I documenti collegano metadati e SHA-256 a un blob immutabile nel filesystem. La scrittura passa da un temporaneo sullo stesso filesystem, `fsync`, hash e collegamento atomico che non sovrascrive un blob già presente. Solo dopo la persistenza dei byte, un’unica transazione collega o crea la pratica, registra il documento e accoda la verifica; un fallimento precedente al commit non lascia una pratica vuota. I temporanei di upload sopravvissuti a un riavvio vengono rimossi dopo un grace period. I job equivalenti sono deduplicati da tipo e input hash; un job rimasto `running` al riavvio passa da `interrupted` e torna in coda soltanto entro il limite di tentativi.
