import { createHash } from "node:crypto";

const DIZ_ROOT = "finanze.IDAC.structSUC.SavedDataSUC13";
const SAVED_DATA = "finanze.IDAC.struct.SavedData";
const DIC_QUADRO_SUFFIX = ".DicQuadro";
const DIC_MODULO_SUFFIX = ".DicModulo";
const RECORD_PARSER_SUFFIX = ".RecordParser";
const FRONTESPIZIO_QUADRO = "B";
const FRONTESPIZIO_MODULE = "00000001";
const FRONTESPIZIO_RECORD_FIELDS = 111;

type XmlElement = {
  readonly name: string;
  readonly attributes: ReadonlyMap<string, string>;
  readonly children: XmlElement[];
  readonly start: number;
  readonly contentStart: number;
  endTagStart: number;
  end: number;
  selfClosing: boolean;
};

export type DizFieldLocator = {
  readonly quadro: string;
  readonly module: string;
  readonly field: string;
};

export type DizField = DizFieldLocator & {
  readonly value: string;
};

export type ParsedXstreamDiz = {
  readonly fields: readonly DizField[];
  readonly rootName: typeof DIZ_ROOT;
  readonly attachmentReferences: readonly string[];
  readonly source: string;
  readonly root: XmlElement;
  readonly fieldKeyElements: ReadonlyMap<string, XmlElement>;
  readonly fieldElements: ReadonlyMap<string, XmlElement>;
};

function findMarkupEnd(source: string, start: number): number {
  let quote = "";
  for (let cursor = start; cursor < source.length; cursor += 1) {
    const char = source[cursor]!;
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return cursor;
    }
  }
  throw new Error("DIZ XML non valido: tag non terminato");
}

function parseAttributes(markup: string): ReadonlyMap<string, string> {
  const attributes = new Map<string, string>();
  const nameMatch = /^<[^\s/>]+/.exec(markup);
  if (!nameMatch) throw new Error("DIZ XML non valido: nome del tag assente");
  let cursor = nameMatch[0].length;
  while (cursor < markup.length) {
    while (/\s/.test(markup[cursor] ?? "")) cursor += 1;
    if (cursor >= markup.length || markup[cursor] === ">" || markup.startsWith("/>", cursor)) break;
    const match = /^([^\s=/>]+)\s*=\s*(["'])(.*?)\2/s.exec(markup.slice(cursor));
    if (!match) throw new Error("DIZ XML non valido: attributo non riconosciuto");
    const [, name, , value] = match;
    if (!name || value === undefined || attributes.has(name)) {
      throw new Error("DIZ XML non valido: attributo duplicato o incompleto");
    }
    attributes.set(name, decodeXml(value));
    cursor += match[0].length;
  }
  return attributes;
}

function parseXml(source: string): XmlElement {
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) {
    throw new Error("DIZ XML non supportato: DTD o entità dichiarate");
  }
  const stack: XmlElement[] = [];
  let root: XmlElement | undefined;
  let cursor = 0;
  while (cursor < source.length) {
    const opening = source.indexOf("<", cursor);
    const textEnd = opening < 0 ? source.length : opening;
    if (textEnd > cursor) decodeXml(source.slice(cursor, textEnd));
    if (opening < 0) {
      cursor = source.length;
      break;
    }
    if (source.startsWith("<!--", opening)) {
      const end = source.indexOf("-->", opening + 4);
      if (end < 0) throw new Error("DIZ XML non valido: commento non terminato");
      const comment = source.slice(opening + 4, end);
      assertXmlCharacters(comment);
      if (comment.includes("--") || comment.endsWith("-")) {
        throw new Error("DIZ XML non valido: contenuto del commento non ammesso");
      }
      cursor = end + 3;
      continue;
    }
    if (source.startsWith("<![CDATA[", opening)) {
      const end = source.indexOf("]]>", opening + 9);
      if (end < 0) throw new Error("DIZ XML non valido: CDATA non terminata");
      assertXmlCharacters(source.slice(opening + 9, end));
      cursor = end + 3;
      continue;
    }
    if (source.startsWith("<?", opening)) {
      const end = source.indexOf("?>", opening + 2);
      if (end < 0) throw new Error("DIZ XML non valido: istruzione non terminata");
      assertXmlCharacters(source.slice(opening + 2, end));
      cursor = end + 2;
      continue;
    }
    if (source.startsWith("</", opening)) {
      const end = findMarkupEnd(source, opening + 2);
      const closingName = source.slice(opening + 2, end).trim();
      const element = stack.pop();
      if (!element || element.name !== closingName) {
        throw new Error("DIZ XML non valido: chiusura dei tag incoerente");
      }
      element.endTagStart = opening;
      element.end = end + 1;
      cursor = end + 1;
      continue;
    }
    if (source.startsWith("<!", opening)) {
      throw new Error("DIZ XML non supportato: dichiarazione XML inattesa");
    }

    const end = findMarkupEnd(source, opening + 1);
    const markup = source.slice(opening, end + 1);
    const name = /^<([^\s/>]+)/.exec(markup)?.[1];
    if (!name) throw new Error("DIZ XML non valido: nome del tag assente");
    const selfClosing = /\/\s*>$/.test(markup);
    const element: XmlElement = {
      name,
      attributes: parseAttributes(markup),
      children: [],
      start: opening,
      contentStart: end + 1,
      endTagStart: end + 1,
      end: end + 1,
      selfClosing,
    };
    const parent = stack.at(-1);
    if (parent) parent.children.push(element);
    else if (root) throw new Error("DIZ XML non valido: più elementi radice");
    else root = element;
    if (!selfClosing) stack.push(element);
    cursor = end + 1;
  }
  if (stack.length > 0 || !root) throw new Error("DIZ XML non valido: struttura incompleta");
  if (source.slice(0, root.start).trim() || source.slice(root.end).trim()) {
    throw new Error("DIZ XML non valido: contenuto fuori dalla radice");
  }
  return root;
}

function decodeXml(value: string): string {
  assertXmlCharacters(value);
  for (let cursor = value.indexOf("&"); cursor >= 0; cursor = value.indexOf("&", cursor + 1)) {
    if (!/^&(?:#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/.test(value.slice(cursor))) {
      throw new Error("DIZ XML non valido: riferimento a entità non riconosciuto");
    }
  }

  return value.replaceAll(
    /&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g,
    (_entity, body: string) => {
      if (body === "amp") return "&";
      if (body === "lt") return "<";
      if (body === "gt") return ">";
      if (body === "quot") return '"';
      if (body === "apos") return "'";
      const codePoint = body.startsWith("#x")
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      if (!Number.isSafeInteger(codePoint) || !isXmlCodePoint(codePoint)) {
        throw new Error("DIZ XML non valido: entità numerica fuori intervallo");
      }
      return String.fromCodePoint(codePoint);
    },
  );
}

function assertXmlCharacters(value: string): void {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (!isXmlCodePoint(codePoint)) {
      throw new Error("DIZ XML non valido: carattere fuori intervallo XML 1.0");
    }
  }
}

function isXmlCodePoint(codePoint: number): boolean {
  return (
    codePoint === 0x09 ||
    codePoint === 0x0a ||
    codePoint === 0x0d ||
    (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0x10ffff)
  );
}

function encodeXml(value: string): string {
  assertXmlCharacters(value);
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function directChild(element: XmlElement, name: string): XmlElement | undefined {
  return element.children.find((child) => child.name === name);
}

function scalar(source: string, element: XmlElement): string {
  if (element.children.length > 0 || element.selfClosing) {
    throw new Error("DIZ XML non valido: valore scalare strutturalmente inatteso");
  }
  const value = source.slice(element.contentStart, element.endTagStart);
  if (value.includes("<")) {
    throw new Error("DIZ XML non supportato: markup dentro un valore scalare");
  }
  return decodeXml(value);
}

function locatorKey(locator: DizFieldLocator): string {
  return `${locator.quadro}\u0000${locator.module}\u0000${locator.field}`;
}

function extractFields(
  source: string,
  root: XmlElement,
): {
  fields: DizField[];
  fieldKeyElements: ReadonlyMap<string, XmlElement>;
  fieldElements: ReadonlyMap<string, XmlElement>;
} {
  const savedData = directChild(root, SAVED_DATA);
  if (!savedData) throw new Error("DIZ XML non valido: SavedData assente");
  const quadroTable = savedData.children.find((candidate) =>
    candidate.children.some(
      (entry) => entry.name === "entry" && entry.children[1]?.name.endsWith(DIC_QUADRO_SUFFIX),
    ),
  );
  if (!quadroTable) throw new Error("DIZ XML non valido: tabella dei quadri assente");

  const fields: DizField[] = [];
  const fieldKeyElements = new Map<string, XmlElement>();
  const fieldElements = new Map<string, XmlElement>();
  for (const quadroEntry of quadroTable.children.filter((child) => child.name === "entry")) {
    const [quadroKey, quadroObject] = quadroEntry.children;
    if (!quadroKey || !quadroObject?.name.endsWith(DIC_QUADRO_SUFFIX)) continue;
    const quadro = scalar(source, quadroKey);
    const modules = directChild(quadroObject, "subElements");
    if (!modules) continue;
    for (const moduleEntry of modules.children.filter((child) => child.name === "entry")) {
      const [moduleKey, moduleObject] = moduleEntry.children;
      if (!moduleKey || !moduleObject?.name.endsWith(DIC_MODULO_SUFFIX)) continue;
      const module = scalar(source, moduleKey);
      const moduleElements = directChild(moduleObject, "subElements");
      const fieldTable = moduleElements ? directChild(moduleElements, "hashtable") : undefined;
      if (!fieldTable) continue;
      const strings = fieldTable.children.filter((child) => child.name === "string");
      if (strings.length % 2 !== 0) {
        throw new Error("DIZ XML non valido: tabella campi con coppia incompleta");
      }
      for (let index = 0; index < strings.length; index += 2) {
        const keyElement = strings[index]!;
        const valueElement = strings[index + 1]!;
        const field = scalar(source, keyElement);
        const value = scalar(source, valueElement);
        const locator = { quadro, module, field };
        const key = locatorKey(locator);
        if (fieldElements.has(key)) {
          throw new Error("DIZ XML non valido: localizzatore campo duplicato");
        }
        fieldKeyElements.set(key, keyElement);
        fieldElements.set(key, valueElement);
        fields.push({ ...locator, value });
      }
    }
  }

  const recordParsers = savedData.children.filter((child) =>
    child.name.endsWith(RECORD_PARSER_SUFFIX),
  );
  if (recordParsers.length > 1) {
    throw new Error("DIZ XML non valido: più record Frontespizio");
  }
  const recordParser = recordParsers[0];
  if (recordParser) {
    const resourceData = directChild(recordParser, "resourceData");
    if (!resourceData) throw new Error("DIZ XML non valido: dati Frontespizio assenti");
    if (
      resourceData.children.length !== FRONTESPIZIO_RECORD_FIELDS ||
      resourceData.children.some((child) => child.name !== "string")
    ) {
      throw new Error("DIZ XML non supportato: tracciato Frontespizio inatteso");
    }
    for (const [index, valueElement] of resourceData.children.entries()) {
      const locator = {
        quadro: FRONTESPIZIO_QUADRO,
        module: FRONTESPIZIO_MODULE,
        field: String(index + 1),
      };
      const key = locatorKey(locator);
      if (fieldElements.has(key)) {
        throw new Error("DIZ XML non valido: localizzatore campo duplicato");
      }
      fieldElements.set(key, valueElement);
      fields.push({ ...locator, value: scalar(source, valueElement) });
    }
  }
  return { fields, fieldKeyElements, fieldElements };
}

function descendants(element: XmlElement): XmlElement[] {
  return [element, ...element.children.flatMap(descendants)];
}

export function parseXstreamDiz(input: Uint8Array): ParsedXstreamDiz {
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(input);
  } catch {
    throw new Error("DIZ XML non supportato: codifica diversa da UTF-8");
  }
  const root = parseXml(source);
  if (root.name !== DIZ_ROOT) {
    throw new Error(`DIZ XML non supportato: radice ${root.name}`);
  }
  const { fields, fieldKeyElements, fieldElements } = extractFields(source, root);
  const attachmentReferences = descendants(root)
    .filter((element) => element.name.endsWith(".AllegatiBean"))
    .flatMap((element) => element.children.filter((child) => child.name === "path"))
    .map((element) => scalar(source, element));
  return {
    fields,
    rootName: DIZ_ROOT,
    attachmentReferences,
    source,
    root,
    fieldKeyElements,
    fieldElements,
  };
}

export function opaqueXstreamProjection(
  parsed: ParsedXstreamDiz,
  scalarReplacements: ReadonlyMap<string, string> = new Map(),
): string {
  const maskedValues = new Map<number, string>([
    ...[...parsed.fieldKeyElements.values()].map(
      (element) => [element.start, "\u0000DIZ-FIELD-KEY\u0000"] as const,
    ),
    ...[...parsed.fieldElements.values()].map(
      (element) => [element.start, "\u0000DIZ-FIELD-VALUE\u0000"] as const,
    ),
  ]);
  return canonicalOpaqueElement(parsed.source, parsed.root, maskedValues, scalarReplacements);
}

function canonicalOpaqueElement(
  source: string,
  element: XmlElement,
  maskedValues: ReadonlyMap<number, string>,
  scalarReplacements: ReadonlyMap<string, string>,
): string {
  const attributes = [...element.attributes.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const masked = maskedValues.get(element.start);
  if (masked !== undefined) return opaqueDigest([element.name, attributes, masked]);
  if (element.children.length === 0) {
    const rawValue = source.slice(element.contentStart, element.endTagStart);
    const decodedValue = rawValue.includes("<") ? rawValue : decodeXml(rawValue);
    const value = scalarReplacements.get(decodedValue) ?? decodedValue;
    return opaqueDigest([element.name, attributes, element.selfClosing, value]);
  }

  const gaps: string[] = [];
  let cursor = element.contentStart;
  for (const child of element.children) {
    gaps.push(source.slice(cursor, child.start));
    cursor = child.end;
  }
  gaps.push(source.slice(cursor, element.endTagStart));
  const children = element.children.map((child) =>
    canonicalOpaqueElement(source, child, maskedValues, scalarReplacements),
  );
  const hasOnlyFormattingGaps = gaps.every((gap) => gap.trim() === "");
  let content: unknown = hasOnlyFormattingGaps
    ? children
    : children.flatMap((child, index) => [gaps[index], child]).concat(gaps.at(-1));

  if (element.name === "hashtable" && hasOnlyFormattingGaps) {
    if (element.children.every((child) => child.name === "entry")) {
      content = [...children].sort();
    } else if (
      element.children.length >= 3 &&
      element.children[0]?.name === "default" &&
      element.children[1]?.name === "int" &&
      element.children[2]?.name === "int"
    ) {
      if ((element.children.length - 3) % 2 === 0) {
        const pairs: string[] = [];
        for (let index = 3; index < children.length; index += 2) {
          pairs.push(JSON.stringify([children[index], children[index + 1]]));
        }
        content = ["\u0000XSTREAM-HASHTABLE-METADATA\u0000", ...pairs.sort()];
      } else {
        const normalizedChildren: string[] = ["\u0000XSTREAM-HASHTABLE-METADATA\u0000"];
        for (let index = 3; index < children.length;) {
          const fieldPairs: string[] = [];
          while (
            maskedValues.get(element.children[index]?.start ?? -1) ===
              "\u0000DIZ-FIELD-KEY\u0000" &&
            maskedValues.get(element.children[index + 1]?.start ?? -1) ===
              "\u0000DIZ-FIELD-VALUE\u0000"
          ) {
            fieldPairs.push(JSON.stringify([children[index], children[index + 1]]));
            index += 2;
          }
          if (fieldPairs.length > 0) {
            normalizedChildren.push(
              JSON.stringify(["\u0000DIZ-FIELDS\u0000", ...fieldPairs.sort()]),
            );
          } else {
            normalizedChildren.push(children[index]!);
            index += 1;
          }
        }
        content = normalizedChildren;
      }
    }
  }
  return opaqueDigest([element.name, attributes, element.selfClosing, content]);
}

function opaqueDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function rewriteXstreamFields(
  parsed: ParsedXstreamDiz,
  changes: readonly (DizFieldLocator & {
    readonly expectedValue: string;
    readonly value: string;
  })[],
): Buffer {
  const replacements = changes.map((change) => {
    const element = parsed.fieldElements.get(locatorKey(change));
    if (!element) throw new Error("DIZ XML: campo richiesto assente");
    const currentValue = scalar(parsed.source, element);
    if (currentValue !== change.expectedValue) {
      throw new Error("DIZ XML: valore corrente diverso da quello atteso");
    }
    return {
      start: element.contentStart,
      end: element.endTagStart,
      value: encodeXml(change.value),
    };
  });
  const starts = new Set(replacements.map((replacement) => replacement.start));
  if (starts.size !== replacements.length) throw new Error("DIZ XML: campo modificato più volte");

  let output = parsed.source;
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    output = output.slice(0, replacement.start) + replacement.value + output.slice(replacement.end);
  }
  return Buffer.from(output, "utf8");
}
