import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { deflateRawSync } from "node:zlib";

import {
  crc32,
  MAX_DIZ_COMPRESSED_BYTES,
  MAX_DIZ_EXPANDED_BYTES,
} from "../../src/domain/diz/archive.ts";
import {
  catalogFieldForMapping,
  compareDizFields,
  type DizWritePreflight,
  MAX_OFFICIAL_ATTACHMENT_BYTES,
  parseDiz,
  QUALIFIED_DIZ_FIELD_MAPPINGS,
  rewriteDizFields,
} from "../../src/domain/diz/index.ts";

type SyntheticEntry = {
  name: string;
  content: Buffer;
  method?: 0 | 8;
  extra?: Buffer;
  comment?: Buffer;
};

function syntheticXml(): Buffer {
  return Buffer.from(
    `<finanze.IDAC.structSUC.SavedDataSUC13 serialization="custom">` +
      `<finanze.IDAC.struct.SavedData>` +
      `<hashtable>` +
      `<entry><string>EA</string><it.finanze.entrate.sco.generale2013.DicQuadro>` +
      `<subElements><entry><string>00000001</string>` +
      `<it.finanze.entrate.sco.generale2013.DicModulo>` +
      `<subElements class="it.finanze.entrate.sco.generale2013.DicElement$1" serialization="custom">` +
      `<unserializable-parents/><hashtable><default><loadFactor>0.75</loadFactor>` +
      `<threshold>2</threshold></default><int>2</int><int>2</int>` +
      `<string>001001</string><string>AAAAAA00A00A000A</string>` +
      `<string>001005</string><string>ROSSI &amp; FIGLI</string>` +
      `<blocco-sconosciuto flag="da-preservare">immutabile</blocco-sconosciuto>` +
      `</hashtable></subElements></it.finanze.entrate.sco.generale2013.DicModulo>` +
      `</entry></subElements></it.finanze.entrate.sco.generale2013.DicQuadro></entry>` +
      `</hashtable>` +
      `<hashtable><entry><string>00000001</string><hashtable><entry><string>0001</string>` +
      `<finanze.IDAC.struct.AllegatiBean><path>allegato</path></finanze.IDAC.struct.AllegatiBean>` +
      `</entry></hashtable></entry></hashtable>` +
      `</finanze.IDAC.struct.SavedData>` +
      `</finanze.IDAC.structSUC.SavedDataSUC13>`,
    "utf8",
  );
}

function makeZip(entries: readonly SyntheticEntry[]): Buffer {
  const localRecords: Buffer[] = [];
  const centralRecords: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const extra = entry.extra ?? Buffer.alloc(0);
    const comment = entry.comment ?? Buffer.alloc(0);
    const method = entry.method ?? 8;
    const compressed = method === 0 ? entry.content : deflateRawSync(entry.content);
    const checksum = crc32(entry.content);
    const local = Buffer.alloc(30 + name.length + extra.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(extra.length, 28);
    name.copy(local, 30);
    extra.copy(local, 30 + name.length);
    localRecords.push(local, compressed);

    const central = Buffer.alloc(46 + name.length + extra.length + comment.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(extra.length, 30);
    central.writeUInt16LE(comment.length, 32);
    central.writeUInt32LE(localOffset, 42);
    name.copy(central, 46);
    extra.copy(central, 46 + name.length);
    comment.copy(central, 46 + name.length + extra.length);
    centralRecords.push(central);
    localOffset += local.length + compressed.length;
  }

  const centralSize = centralRecords.reduce((sum, record) => sum + record.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localRecords, ...centralRecords, eocd]);
}

function fixture(xml = syntheticXml()): Buffer {
  return makeZip([
    {
      name: "allegato",
      content: Buffer.from("%PDF-1.7\nfixture sintetica\n%%EOF", "ascii"),
      extra: Buffer.from([0xfe, 0xca, 0x00, 0x00]),
      comment: Buffer.from("unknown-metadata", "ascii"),
    },
    { name: "data.xml", content: xml },
  ]);
}

function attachmentPreflight(input: Buffer): DizWritePreflight {
  return {
    qualifiedAttachments: parseDiz(input).attachments.map((attachment) => ({
      sha256: attachment.sha256,
      source: "official-control" as const,
    })),
  };
}

test("legge il contenitore XStream e collega gli allegati", () => {
  const parsed = parseDiz(fixture());
  assert.equal(parsed.format, "xstream-zip-v1");
  assert.equal(parsed.entryCount, 2);
  assert.equal(parsed.fields.length, 2);
  assert.deepEqual(
    parsed.fields.map(({ quadro, module, field, value }) => ({ quadro, module, field, value })),
    [
      { quadro: "EA", module: "00000001", field: "001001", value: "AAAAAA00A00A000A" },
      { quadro: "EA", module: "00000001", field: "001005", value: "ROSSI & FIGLI" },
    ],
  );
  assert.deepEqual(
    parsed.attachments.map(({ name, kind, referenced }) => ({ name, kind, referenced })),
    [{ name: "allegato", kind: "pdf", referenced: true }],
  );
});

test("il no-op restituisce gli stessi byte", () => {
  const input = fixture();
  assert.deepEqual(rewriteDizFields(input, []), input);
});

test("modifica un solo valore e preserva allegato e blocchi sconosciuti", () => {
  const input = fixture();
  const before = parseDiz(input);
  const output = rewriteDizFields(
    input,
    [
      {
        quadro: "EA",
        module: "00000001",
        field: "001005",
        expectedValue: "ROSSI & FIGLI",
        value: "A&B<C",
      },
    ],
    attachmentPreflight(input),
  );
  const after = parseDiz(output);

  assert.equal(
    after.fields.find((field) => field.quadro === "EA" && field.field === "001005")?.value,
    "A&B<C",
  );
  assert.equal(after.attachments[0]?.sha256, before.attachments[0]?.sha256);
  assert.match(
    after.xstream.source,
    /<blocco-sconosciuto flag="da-preservare">immutabile<\/blocco-sconosciuto>/,
  );

  const beforeAttachment = before.source.entries.find((entry) => entry.name === "allegato")!;
  const afterAttachment = after.source.entries.find((entry) => entry.name === "allegato")!;
  assert.deepEqual(afterAttachment.rawLocalRecord, beforeAttachment.rawLocalRecord);
  assert.deepEqual(
    afterAttachment.rawCentralRecord.subarray(0, 42),
    beforeAttachment.rawCentralRecord.subarray(0, 42),
  );
});

test("espone soltanto mapping qualificati collegati al catalogo ufficiale", () => {
  assert.deepEqual(QUALIFIED_DIZ_FIELD_MAPPINGS, [
    {
      status: "qualified",
      dizCode: "EA001005",
      catalogFieldId: "quadro-ea.soggetto.dati-anagrafici.cognome",
      officialPath: "/Fornitura/Dichiarazione/QuadroEA/Modulo/Soggetto/DatiAnagrafici/Cognome",
      sourceIds: ["SRC-08"],
      evidence: {
        method: "one-field-official-round-trip",
        platform: "macOS",
        software: "SuccessioniOnLine",
        softwareVersion: "2.3.1",
        verifiedOn: "2026-08-24",
      },
    },
  ]);
  assert.equal(catalogFieldForMapping(QUALIFIED_DIZ_FIELD_MAPPINGS[0]!).maxLength, 80);
});

test("blocca campi non qualificati, valori base divergenti e valori fuori catalogo", () => {
  const input = fixture();
  assert.throws(
    () =>
      rewriteDizFields(
        input,
        [
          {
            quadro: "EA",
            module: "00000001",
            field: "001001",
            expectedValue: "AAAAAA00A00A000A",
            value: "BBBBBB00B00B000B",
          },
        ],
        attachmentPreflight(input),
      ),
    /mapping ufficiale non qualificato/,
  );
  assert.throws(
    () =>
      rewriteDizFields(
        input,
        [
          {
            quadro: "EA",
            module: "00000001",
            field: "001005",
            expectedValue: "valore obsoleto",
            value: "BIANCHI",
          },
        ],
        attachmentPreflight(input),
      ),
    /valore corrente diverso/,
  );
  assert.throws(
    () =>
      rewriteDizFields(
        input,
        [
          {
            quadro: "EA",
            module: "00000001",
            field: "001005",
            expectedValue: "ROSSI & FIGLI",
            value: "X".repeat(81),
          },
        ],
        attachmentPreflight(input),
      ),
    /limite ufficiale di 80 caratteri/,
  );
  assert.throws(
    () =>
      rewriteDizFields(
        input,
        [
          {
            quadro: "EA",
            module: "00000001",
            field: "001005",
            expectedValue: "ROSSI & FIGLI",
            value: "ROSSI\u0000BIANCHI",
          },
        ],
        attachmentPreflight(input),
      ),
    /carattere fuori intervallo XML 1\.0/,
  );
});

test("blocca allegati senza preflight, oltre 5 MiB o in formato finale non ammesso", () => {
  const change = {
    quadro: "EA",
    module: "00000001",
    field: "001005",
    expectedValue: "ROSSI & FIGLI",
    value: "BIANCHI",
  };
  const input = fixture();
  assert.throws(
    () => rewriteDizFields(input, [change]),
    /preflight ufficiale PDF\/A o TIFF assente/,
  );
  assert.throws(
    () =>
      rewriteDizFields(input, [change], {
        qualifiedAttachments: [{ sha256: "0".repeat(64), source: "official-control" }],
      }),
    /preflight ufficiale PDF\/A o TIFF assente/,
  );

  const jpeg = makeZip([
    { name: "allegato", content: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) },
    { name: "data.xml", content: syntheticXml() },
  ]);
  assert.throws(
    () => rewriteDizFields(jpeg, [change], attachmentPreflight(jpeg)),
    /formato allegato finale non ammesso/,
  );

  const oversized = makeZip([
    {
      name: "allegato",
      content: Buffer.concat([
        Buffer.from("%PDF", "ascii"),
        Buffer.alloc(MAX_OFFICIAL_ATTACHMENT_BYTES - 3),
      ]),
    },
    { name: "data.xml", content: syntheticXml() },
  ]);
  assert.throws(
    () => rewriteDizFields(oversized, [change], attachmentPreflight(oversized)),
    /allegato oltre il limite ufficiale di 5 MiB/,
  );
});

test("rifiuta traversal, allegati orfani e CRC corrotti", () => {
  assert.throws(
    () => parseDiz(makeZip([{ name: "../data.xml", content: syntheticXml() }])),
    /percorso entry non sicuro/,
  );
  assert.throws(
    () =>
      parseDiz(
        makeZip([
          { name: "allegato", content: Buffer.from("%PDF-fixture", "ascii") },
          {
            name: "data.xml",
            content: Buffer.from(syntheticXml().toString().replace("allegato", "mancante")),
          },
        ]),
      ),
    /allegato assente/,
  );
  const corrupted = fixture();
  const firstDataOffset = 30 + corrupted.readUInt16LE(26) + corrupted.readUInt16LE(28);
  corrupted.writeUInt8(corrupted.readUInt8(firstDataOffset) ^ 0xff, firstDataOffset);
  assert.throws(() => parseDiz(corrupted), /decompressione fallita|CRC/);
});

test("applica i limiti compressi ed espansi del DIZ", () => {
  assert.throws(
    () => parseDiz(Buffer.alloc(MAX_DIZ_COMPRESSED_BYTES + 1)),
    /limite compresso di 40 MiB/,
  );

  const forgedExpandedSize = fixture();
  const eocdOffset = forgedExpandedSize.length - 22;
  const centralOffset = forgedExpandedSize.readUInt32LE(eocdOffset + 16);
  forgedExpandedSize.writeUInt32LE(MAX_DIZ_EXPANDED_BYTES + 1, centralOffset + 24);
  assert.throws(() => parseDiz(forgedExpandedSize), /contenuto espanso oltre il limite/);
});

test("rifiuta separatori e percorsi dipendenti dal sistema operativo", () => {
  for (const name of ["/data.xml", "C:\\data.xml", "cartella\\data.xml"]) {
    assert.throws(
      () => parseDiz(makeZip([{ name, content: syntheticXml() }])),
      /percorso entry non sicuro/,
    );
  }
  const absoluteReference = Buffer.from(
    syntheticXml().toString().replace("allegato", "C:\\allegato"),
  );
  assert.throws(
    () =>
      parseDiz(
        makeZip([
          { name: "allegato", content: Buffer.from("%PDF-fixture", "ascii") },
          { name: "data.xml", content: absoluteReference },
        ]),
      ),
    /percorso entry non sicuro/,
  );
});

test("rifiuta entità XML sconosciute, ampersand grezzi e markup nei valori", () => {
  for (const value of [
    "ROSSI & FIGLI",
    "ROSSI &sconosciuta; FIGLI",
    "ROSSI &#xD800; FIGLI",
    "<![CDATA[ROSSI & FIGLI]]>",
    "<!--commento-->ROSSI",
  ]) {
    const xml = Buffer.from(syntheticXml().toString().replace("ROSSI &amp; FIGLI", value), "utf8");
    assert.throws(() => parseDiz(fixture(xml)), /DIZ XML non valido|DIZ XML non supportato/);
  }

  const invalidUnknownBlock = Buffer.from(
    syntheticXml().toString().replace("immutabile", "testo & non valido"),
    "utf8",
  );
  assert.throws(() => parseDiz(fixture(invalidUnknownBlock)), /entità non riconosciuto/);
});

test("preserva terminatori CRLF e metadati non interpretati", () => {
  const xml = Buffer.from(syntheticXml().toString().replaceAll("><", ">\r\n<"), "utf8");
  const output = rewriteDizFields(
    fixture(xml),
    [
      {
        quadro: "EA",
        module: "00000001",
        field: "001005",
        expectedValue: "ROSSI & FIGLI",
        value: "BIANCHI",
      },
    ],
    attachmentPreflight(fixture(xml)),
  );
  const source = parseDiz(output).xstream.source;
  assert.match(source, /\r\n/);
  assert.doesNotMatch(source.replaceAll("\r\n", ""), /\n/);
});

test("classifica deterministicamente il confronto a tre vie", () => {
  const field = (module: string, value: string) => ({
    quadro: "EA",
    module,
    field: "001005",
    value,
  });
  const comparison = compareDizFields(
    [field("001001", "base"), field("001005", "base"), field("001006", "base")],
    [field("001001", "base"), field("001005", "locale"), field("001006", "locale")],
    [field("001001", "ufficiale"), field("001005", "base"), field("001006", "ufficiale")],
  );
  assert.deepEqual(
    comparison.importFromOfficial.map((item) => item.module),
    ["001001"],
  );
  assert.deepEqual(
    comparison.keepCurrent.map((item) => item.module),
    ["001005"],
  );
  assert.deepEqual(
    comparison.conflicts.map((item) => item.module),
    ["001006"],
  );
  assert.equal(comparison.opaque.length, 0);
  assert.equal(comparison.unchanged.length, 0);
});

test("separa la modifica ufficiale dalla normalizzazione interna aggiunta da SUC13", () => {
  const field = (quadro: string, fieldName: string, value: string) => ({
    quadro,
    module: "00000001",
    field: fieldName,
    value,
  });
  const base = [field("EA", "001005", "ORIGINALE")];
  const comparison = compareDizFields(base, base, [
    field("EA", "001005", "MODIFICATO"),
    field("VV", "999999", "7"),
  ]);

  assert.deepEqual(
    comparison.importFromOfficial.map(({ quadro, field: fieldName }) => [quadro, fieldName]),
    [["EA", "001005"]],
  );
  assert.deepEqual(
    comparison.opaque.map(({ quadro, field: fieldName }) => [quadro, fieldName]),
    [["VV", "999999"]],
  );
  assert.equal(comparison.conflicts.length, 0);
});

test("l'inspector non espone il nome fiscale del file", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "sequent-diz-"));
  try {
    const file = path.join(directory, "AAAAAA00A00A000A.diz");
    writeFileSync(file, fixture());
    const output = execFileSync(process.execPath, ["scripts/diz/inspect.ts", file], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.doesNotMatch(output, /AAAAAA00A00A000A/);
    assert.match(output, /"format": "xstream-zip-v1"/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("il confronto CLI non espone nomi di file o valori fiscali", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "sequent-diz-compare-"));
  try {
    const base = path.join(directory, "BASE-AAAAAA00A00A000A.diz");
    const current = path.join(directory, "CURRENT-BBBBBB00B00B000B.diz");
    const official = path.join(directory, "OFFICIAL-CCCCCC00C00C000C.diz");
    writeFileSync(base, fixture());
    writeFileSync(current, fixture());
    writeFileSync(
      official,
      rewriteDizFields(
        fixture(),
        [
          {
            quadro: "EA",
            module: "00000001",
            field: "001005",
            expectedValue: "ROSSI & FIGLI",
            value: "BIANCHI",
          },
        ],
        attachmentPreflight(fixture()),
      ),
    );
    const output = execFileSync(
      process.execPath,
      ["scripts/diz/compare.ts", base, current, official],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    for (const privateValue of [
      "AAAAAA00A00A000A",
      "BBBBBB00B00B000B",
      "CCCCCC00C00C000C",
      "ROSSI & FIGLI",
      "BIANCHI",
    ]) {
      assert.doesNotMatch(output, new RegExp(privateValue.replaceAll("&", "&amp;")));
    }
    assert.match(output, /"locator": "EA\/00000001\/001005"/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("l'inventario distingue origine non codificata e round-trip ufficiale", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "sequent-diz-inventory-"));
  try {
    const corpus = path.join(directory, "corpus");
    const output = path.join(directory, "inventory.json");
    mkdirSync(corpus);
    writeFileSync(path.join(corpus, "campione.diz"), fixture());
    execFileSync(
      process.execPath,
      [
        "scripts/diz/inventory.ts",
        corpus,
        "--authorized-on",
        "2026-08-24",
        "--output",
        output,
        "--round-trip-samples",
        "sample-01",
        "--qualification-on",
        "2026-08-24",
        "--qualification-platform",
        "macOS",
        "--qualification-software",
        "SuccessioniOnLine",
        "--qualification-version",
        "2.3.1",
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    const inventory = JSON.parse(readFileSync(output, "utf8"));
    assert.equal(inventory.schemaVersion, 2);
    assert.equal(inventory.samples[0].declarationType.status, "unqualified");
    assert.equal(inventory.samples[0].sourceEnvironment.status, "not-encoded-in-diz");
    assert.equal(inventory.samples[0].interoperabilityEvidence.status, "official-round-trip");
    assert.equal(inventory.samples[0].interoperabilityEvidence.softwareVersion, "2.3.1");
    assert.equal(statSync(output).mode & 0o777, 0o600);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
