import { deflateRawSync } from "node:zlib";
import { crc32 } from "../../src/domain/diz/archive.ts";

function makeZip(entries: readonly { name: string; content: Buffer }[]): Buffer {
  const localRecords: Buffer[] = [];
  const centralRecords: Buffer[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.content);
    const checksum = crc32(entry.content);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.content.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    localRecords.push(local, compressed);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    name.copy(central, 46);
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

export function syntheticDiz(
  cognome = "ROSSI",
  attachment?: { name: string; content: Buffer },
): Buffer {
  return syntheticDizFromFields(
    [{ quadro: "EA", module: "00000001", field: "001005", value: cognome }],
    attachment,
  );
}

export function syntheticDizFromFields(
  fields: readonly { quadro: string; module: string; field: string; value: string }[],
  attachment?: { name: string; content: Buffer },
  frontespizio?: Readonly<Record<number, string>>,
): Buffer {
  const attachments = attachment
    ? `<hashtable><entry><string>00000001</string><hashtable><entry><string>0001</string>` +
      `<finanze.IDAC.struct.AllegatiBean><path>${attachment.name}</path></finanze.IDAC.struct.AllegatiBean>` +
      `</entry></hashtable></entry></hashtable>`
    : `<hashtable></hashtable>`;
  const quadroEntries = [...new Set(fields.map((field) => field.quadro))]
    .map((quadro) => {
      const modules = [
        ...new Set(fields.filter((field) => field.quadro === quadro).map((field) => field.module)),
      ]
        .map((module) => {
          const pairs = fields
            .filter((field) => field.quadro === quadro && field.module === module)
            .map((field) => `<string>${field.field}</string><string>${field.value}</string>`)
            .join("");
          return (
            `<entry><string>${module}</string><it.finanze.entrate.sco.generale2013.DicModulo>` +
            `<subElements class="it.finanze.entrate.sco.generale2013.DicElement$1" serialization="custom">` +
            `<unserializable-parents/><hashtable><default><loadFactor>0.75</loadFactor>` +
            `<threshold>${fields.length}</threshold></default><int>${fields.length}</int><int>${fields.length}</int>` +
            `${pairs}</hashtable></subElements></it.finanze.entrate.sco.generale2013.DicModulo></entry>`
          );
        })
        .join("");
      return (
        `<entry><string>${quadro}</string>` +
        `<it.finanze.entrate.sco.generale2013.DicQuadro><subElements>${modules}</subElements>` +
        `</it.finanze.entrate.sco.generale2013.DicQuadro></entry>`
      );
    })
    .join("");
  const recordParser = frontespizio
    ? `<it.finanze.entrate.sco.resources.RecordParser><isKeyRequired>false</isKeyRequired>` +
      `<numControlliRes>0</numControlliRes><resourceData class="vector">` +
      Array.from(
        { length: 111 },
        (_, index) => `<string>${frontespizio[index + 1] ?? ""}</string>`,
      ).join("") +
      `</resourceData><pos>0</pos></it.finanze.entrate.sco.resources.RecordParser>`
    : "";
  const xml = Buffer.from(
    `<finanze.IDAC.structSUC.SavedDataSUC13 serialization="custom">` +
      `<finanze.IDAC.struct.SavedData><hashtable>${quadroEntries}</hashtable>` +
      `${recordParser}` +
      `${attachments}</finanze.IDAC.struct.SavedData>` +
      `</finanze.IDAC.structSUC.SavedDataSUC13>`,
    "utf8",
  );
  return makeZip([
    ...(attachment ? [{ name: attachment.name, content: attachment.content }] : []),
    { name: "data.xml", content: xml },
  ]);
}
