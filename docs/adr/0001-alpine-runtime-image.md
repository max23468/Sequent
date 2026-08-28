# Base Alpine per l’immagine applicativa

**Stato:** superata da [ADR 0002 — Debian 13 Slim per l’immagine applicativa](0002-debian-13-slim-runtime-image.md).

Questa ADR conserva la motivazione storica della scelta precedente; non descrive più il runtime corrente.

L’immagine applicativa usa la variante ufficiale Node su Alpine, aggiornata durante la build. La precedente base Debian esponeva vulnerabilità che Debian classificava come non urgenti e non correggibili sulle distribuzioni stabili, ma che la politica di pubblicazione di Sequent deve correttamente bloccare; Alpine consente di conservare il controllo rigoroso senza eccezioni. OCRmyPDF vive in un ambiente Python isolato e versionato perché il pacchetto della distribuzione può rimanere indietro rispetto alle correzioni di sicurezza; OCR, conversione documentale, PDF e CLI Codex devono comunque superare le verifiche dell’immagine completa.
