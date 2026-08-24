# Contratto del modello dati

Il modello canonico resta non congelato finché `TG-COMPLIANCE` è aperto. Viene generato e riconciliato a partire da modello visibile, istruzioni, guida di calcolo, XSD e overlay. Ogni campo registra identificativo stabile, label, quadro, percorso XSD, tipo, cardinalità, regole, periodo di efficacia, provenienza e livello di supporto.

`TG-COMPLIANCE` blocca il congelamento del dominio. Nessun componente UI può introdurre costanti fiscali o mapping non presenti nel catalogo.

## Fondazione persistente

La dichiarazione resta un JSON versionato. SQLite contiene soltanto identità owner, sessioni, indice delle pratiche, documenti e coda persistente. Ogni salvataggio della dichiarazione usa una revisione attesa: una revisione server diversa produce `REVISION_CONFLICT` e non sovrascrive silenziosamente lo stato più recente.

I documenti collegano metadati e SHA-256 a un blob immutabile nel filesystem. La scrittura passa da un temporaneo sullo stesso filesystem, `fsync`, hash e rename atomico prima della transazione di collegamento. I job equivalenti sono deduplicati da tipo e input hash; un job rimasto `running` al riavvio passa da `interrupted` e torna in coda soltanto entro il limite di tentativi.
