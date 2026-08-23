# Sequent — Manifest delle fonti ufficiali

- **Bundle ID:** `SUC-OFFICIAL-2025-07-15-FULL`
- **SHA-256 composito delle fonti:** `f5c4dba027c36609216bd956bfb5dc29eef4978aaa2dc802d85b6e70277b1603`
- **SHA-256 composito dell’albero XSD:** `aa6ec0d226d213447d27a79a5407d2f6a178cfe4962a64954aeeb1b6e238bb83`
- **Pagina ufficiale tecnica:** `https://www.agenziaentrate.gov.it/portale/schede/dichiarazioni/dichiarazione-di-successione/specifiche-tecniche-dichiarazione-di-successione`
- **Metodo:** SHA-256 delle righe ordinate `ID:sha256`, ciascuna terminata da newline.

I dieci artefatti sono identificati dai byte e dagli hash, non dal solo nome. Le fonti superate restano nel bundle per lineage e regressione, ma non governano l’implementazione corrente.

| ID | Alias locale | File originale | Stato | Pagine | Byte | SHA-256 | Ruolo |
|---|---|---|---|---:|---:|---|---|
| `SRC-01` | `istruzioni-fascicolo-1-update-2025-07-15.pdf` | `elenco-modifiche-istruzioni-fascicolo-1.pdf` | current-overlay | 2 | 201322 | `fb1c14f1f8f04a7c9804c66128b6905b68a221472a4322f34324e54bcc8d8857` | Overlay puntuale corrente delle istruzioni del Fascicolo 1. |
| `SRC-02` | `specifiche-tecniche-delta-2025-02.pdf` | `903477a9-d3c9-f21b-3605-594ca021547f.pdf` | lineage | 7 | 267980 | `fe2f724d38f19bc78dcb768835b20817f3e369179d8dac0393753f12771253f7` | Lineage ufficiale e regressione; già consolidato nelle specifiche correnti e non autorevole rispetto a SRC-07–SRC-09. |
| `SRC-03` | `modello-dichiarazione-successione-2025.pdf` | `88520cc9-d27e-71f2-de07-8cd6f2a2953a.pdf` | current | 18 | 1407364 | `26a93d2e30be6e8cead56f53b175e956df4e8c1187db5521e2f461c404e2cce0` | Inventario visuale vincolante di informativa, frontespizio, quadri, sezioni, righi, etichette e ordine. |
| `SRC-04` | `istruzioni-fascicolo-2-2025.pdf` | `7f369d23-164f-7679-a44e-fb941984bdcd.pdf` | current | 17 | 484746 | `33b50daccaab59927e80e78962f2c13c7d22d0483d3f8f8eba317e3107b2a413` | Semantica, istruzioni e calcoli dei quadri EL, EM, EN, EO, EP ed EQ. |
| `SRC-05` | `istruzioni-fascicolo-1-2025-07-15.pdf` | `ebc28cca-a79f-5a00-5a9a-7e4b70611a6b.pdf` | current | 70 | 1944639 | `a760fa067890b645db49da2c496ef3481d5e4d0989be684e22450166ad9040f5` | Istruzioni generali, termini, documenti, ricevute, volture, frontespizio, quadri EA–EI/ER e Allegati 1–5; modificato puntualmente da SRC-01. |
| `SRC-06` | `specifiche-tecniche-suc13-2025-02-03-superseded.pdf` | `1c3bb907-70d9-e4a3-2c1d-f0bbfe35f2ee.pdf` | superseded-reference | 1158 | 8896200 | `04b0a6dd51028c8a937cc6b8c8242f52b914a4b8b2c9259b7db3c54d34ac63e8` | Baseline superata, conservata per diff e non-regressione; non governa il writer corrente. |
| `SRC-07` | `specifiche-tecniche-suc13-2025-07-02.pdf` | `Specifiche_SUC13_20250702.pdf` | current | 1103 | 8885123 | `1b01ebe137b8f870092f0334e8dabc81aecde79376b32c41cf066346365fcb1b` | Documentazione umana corrente di struttura, diagrammi, annotazioni e controlli SUC13. |
| `SRC-08` | `specifiche-tecniche-suc13-xsd-2025-07-02.zip` | `SUC13_20250702 2.zip` | current-machine-readable | — | 91773 | `1e63bd8bd4a79a401e4a2ce1a6580cf20eba2b533a2892361e375aa964c371e9` | Fonte macchina-leggibile corrente: 13 XSD, main schema e dipendenze locali. |
| `SRC-09` | `specifiche-tecniche-delta-2025-07-15.pdf` | `Elenco modifiche specifiche tecniche_15-07-2025.pdf` | current-overlay | 3 | 237787 | `af390406540a5763e55aa91bba1429c7f63dbd86907c16d4fcd12783ba291b07` | Overlay tecnico corrente su controlli, agevolazioni, trust, imposta e campi EA. |
| `SRC-10` | `guida-calcolo-imposta-successione-autoliquidazione-2025.pdf` | `All. Specifiche tecniche (passaggi calcolo imposta di successione).pdf` | current-specialist | 10 | 534348 | `2570aacc73d0ab903fd4b265f50cbf761dd280cd1639653694c991c105b3c447` | Fonte specialistica per formule, passaggi e golden test dell’autoliquidazione dal 1° gennaio 2025. |

## Precedenza

1. SRC-01 overrides SRC-05 only for the instruction portions explicitly modified.
2. SRC-09 overrides SRC-08 and SRC-07 only for the technical elements and controls explicitly modified.
3. SRC-08 is the current machine-readable authority for XML/XSD syntax, namespaces, types, order, cardinality, enumerations and imports; SRC-07 is the corresponding human-readable technical documentation.
4. SRC-10 is the specialist authority for the autoliquidation calculation process from 1 January 2025, together with the applicable instructions and technical constraints.
5. SRC-03 governs visible labels, field inventory, sections and order; SRC-04 and SRC-05 govern semantics and compilation instructions.
6. SRC-02 and SRC-06 are retained only as official lineage and regression material and cannot override SRC-07–SRC-09.
7. Unresolved conflicts block the affected export.

## Archivio XSD

- **File:** `SRC-08`
- **Main schema:** `SUC/xsd/fornituraSUC13_v1.xsd`
- **XSD contenuti:** 13
- **Verifica bootstrap:** tutti i file XML well-formed; main schema compilato con dipendenze esclusivamente locali e senza rete.
- **Nota:** M0 deve ripetere la verifica con la toolchain scelta e produrre il report di riconciliazione con `SRC-07` e `SRC-09`.

### Dependency closure attiva

```text
SUC/xsd/fornituraSUC13_v1.xsd
common/xsd/fornitura_v2.xsd
common/xsd/typesDati_v2.xsd
common/xsd/typesProvincie_v2.xsd
common/xsd/datiFiscali_v3.xsd
common/xsd/typesFiscali_v3.xsd
common/xsd/typeEventi_v3.xsd
common/xsd/telematico_v1.xsd
registro/xsd/typesReg_v2.xsd
```

### XSD preservati ma non raggiunti dal main schema corrente

```text
common/xsd/datiFiscali_v4.xsd
common/xsd/esitoFornitura_v3.xsd
common/xsd/typesDati_v3.xsd
common/xsd/typesFiscali_v4.xsd
```

| Percorso XSD | Byte | SHA-256 |
|---|---:|---|
| `SUC/xsd/fornituraSUC13_v1.xsd` | 293774 | `25fe2af4fb11143fe9464bed6fc536f5166c41fe20c70fca1a4ba38feb9659b6` |
| `common/xsd/datiFiscali_v3.xsd` | 9525 | `78ee6420d5ff4c3442581bd5591df2fb6435e6d0f2543582927f8f95f156654f` |
| `common/xsd/datiFiscali_v4.xsd` | 9678 | `b5ff239c0cfd79512223ee3e9593df82f4f1ba2b9c90196432f6dbef8959e4a7` |
| `common/xsd/esitoFornitura_v3.xsd` | 5002 | `f14b756a70fbc62f277b13fd87637430ec45179f9abae94ed1df4a58dca5b805` |
| `common/xsd/fornitura_v2.xsd` | 2530 | `5ecf4c4ab126c6a41d44803cc150697984bfc243cb59cc4dd7cb9d3b63e9840f` |
| `common/xsd/telematico_v1.xsd` | 1560 | `26b308aae266a241eb0d8a986174c69025cb8d383585e2c3eac3550d94ea5547` |
| `common/xsd/typeEventi_v3.xsd` | 2566 | `c5e51d4194760a9f68bd229ae8066bd25488898113219b8587dae274f6415d7e` |
| `common/xsd/typesDati_v2.xsd` | 8764 | `e59d133c627ea710243b5cf3ee2bf7cd42bd3d9f07bae07b755ed77c4523da9c` |
| `common/xsd/typesDati_v3.xsd` | 7506 | `a78387e21326e3f331f32d4ccd3b2b383ebd4675e5c42793bad2e00cc657b280` |
| `common/xsd/typesFiscali_v3.xsd` | 19740 | `3d54babe6dc90414d1931f24d6c4aaefe28cfd8aa81ed38ea508fba593d01235` |
| `common/xsd/typesFiscali_v4.xsd` | 19794 | `065911d00046240599a3bb5544c63f0ae1fa8ab3c5cee40336cbe013632819e9` |
| `common/xsd/typesProvincie_v2.xsd` | 8331 | `f1c68c41cc070214c7a86fdcbe14fa1ecf26c50adf855d9ce332b7079a262eb4` |
| `registro/xsd/typesReg_v2.xsd` | 254962 | `dd063ba70fa820af4fa8cac29a1f1e63eb7992f30721303eed7f306e692410fc` |

## Verifica rapida

```bash
sha256sum private/official-sources/*.{pdf,zip}
# verificare quindi xsd-manifest.json e compilare:
# private/official-sources/xsd/SUC/xsd/fornituraSUC13_v1.xsd
```
