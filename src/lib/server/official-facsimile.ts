import fontkit from "@pdf-lib/fontkit";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { deriveOfficialFieldValue } from "../../domain/derived-fields.ts";
import {
  getCatalogField,
  listQuadroFields,
  type QuadroId,
} from "../../domain/official-catalog/catalog.ts";
import facsimileLayout from "../../domain/official-catalog/facsimile-layout.json" with { type: "json" };
import {
  CURRENT_CATALOG_VERSION,
  CURRENT_RULESET_VERSION,
  OFFICIAL_SOURCE_BUNDLE_ID,
  getCanonicalField,
  type CanonicalFieldValue,
  type DeclarationSnapshot,
} from "../../domain/declaration.ts";
import { specialFacsimilePlacement } from "./official-facsimile-special-layout.ts";

const require = createRequire(import.meta.url);
const REGULAR_FONT = readFileSync(
  require.resolve("@expo-google-fonts/noto-sans/400Regular/NotoSans_400Regular.ttf"),
);
const BOLD_FONT = readFileSync(
  require.resolve("@expo-google-fonts/noto-sans/700Bold/NotoSans_700Bold.ttf"),
);

const PAGE_WIDTH = 595.276;
const PAGE_HEIGHT = 841.89;
const APPLIED_STATES = new Set<CanonicalFieldValue["state"]>([
  "automatic",
  "confirmed",
  "manually_corrected",
  "calculated",
  "overridden",
]);
const ENTITY_QUADRI = new Set<QuadroId>([
  "EA",
  "EB",
  "EC",
  "ED",
  "EL",
  "EM",
  "EN",
  "EO",
  "EP",
  "EQ",
  "ER",
]);
const ASSET_CAPACITY: Partial<Record<QuadroId, number>> = {
  EA: 3,
  EB: 2,
  EC: 2,
  ED: 3,
  EL: 2,
  EM: 1,
  EN: 2,
  EO: 3,
  EP: 1,
  EQ: 2,
  ER: 4,
};
const SOURCE_PAGES: Record<QuadroId, number[]> = {
  Frontespizio: [2],
  EA: [3],
  EB: [4],
  EC: [5],
  ER: [6],
  ED: [7],
  EE: [8],
  EF: [8],
  EG: [8],
  EH: [9, 10, 11, 12],
  EI: [13],
  EL: [14],
  EM: [15],
  EN: [16],
  EO: [17],
  EP: [18],
  EQ: [18],
};

type Placement = {
  x: number;
  top: number;
  width: number;
  kind?: "text" | "checkbox";
  align?: "left" | "center";
  verticalOffset?: number;
  rightInset?: number;
};

const FRONT_FIELDS: Record<string, Placement> = {
  "frontespizio.defunto.codice-fiscale": {
    x: 345,
    top: 115,
    width: 210,
    verticalOffset: -8,
  },
  "frontespizio.dichiarazione.prima": { x: 136, top: 216, width: 12, kind: "checkbox" },
  "frontespizio.dichiarazione.sostitutiva-tipo": { x: 198, top: 216, width: 17 },
  "frontespizio.dichiarazione-precedente.anno": { x: 181, top: 235, width: 68 },
  "frontespizio.dichiarazione-precedente.volume": { x: 258, top: 235, width: 74 },
  "frontespizio.dichiarazione-precedente.numero": { x: 420, top: 235, width: 77 },
  "frontespizio.devoluzione.per-legge": { x: 255, top: 216, width: 12, kind: "checkbox" },
  "frontespizio.devoluzione.per-testamento": {
    x: 306,
    top: 216,
    width: 12,
    kind: "checkbox",
  },
  "frontespizio.devoluzione.legge-estera": { x: 360, top: 216, width: 12, kind: "checkbox" },
  "frontespizio.eventi-eccezionali": { x: 418, top: 216, width: 12, kind: "checkbox" },
  "frontespizio.data-opzione-24-bis": { x: 462, top: 216, width: 88 },
  "frontespizio.beneficiari.numero-eredi": { x: 127, top: 258, width: 55 },
  "frontespizio.beneficiari.numero-chiamati": { x: 257, top: 258, width: 55 },
  "frontespizio.beneficiari.numero-legatari": { x: 385, top: 258, width: 55 },
  "frontespizio.beneficiari.beneficio-inventario": {
    x: 548,
    top: 258,
    width: 12,
    kind: "checkbox",
  },
  "frontespizio.defunto.cognome": { x: 111, top: 291, width: 210 },
  "frontespizio.defunto.nome": { x: 330, top: 291, width: 205 },
  "frontespizio.defunto.sesso": { x: 548, top: 291, width: 14, align: "center" },
  "frontespizio.defunto.data-nascita": { x: 111, top: 315, width: 112 },
  "frontespizio.defunto.comune-nascita": { x: 229, top: 315, width: 269 },
  "frontespizio.defunto.provincia-nascita": { x: 506, top: 315, width: 54 },
  "frontespizio.defunto.data-decesso": { x: 111, top: 339, width: 112 },
  "frontespizio.defunto.residenza-estera": { x: 346, top: 339, width: 12, kind: "checkbox" },
  "frontespizio.defunto.stato-civile": { x: 545, top: 339, width: 16 },
  "xsd:/Fornitura/Dichiarazione/Frontespizio/TipoDichiarazione/Devoluzione/Testamento/TestamentoEstero":
    {
      x: 122,
      top: 363,
      width: 12,
      kind: "checkbox",
    },
  "xsd:/Fornitura/Dichiarazione/Frontespizio/TipoDichiarazione/Devoluzione/Testamento/Pubblicazione/PubblicoUfficiale":
    {
      x: 159,
      top: 363,
      width: 305,
    },
  "xsd:/Fornitura/Dichiarazione/Frontespizio/TipoDichiarazione/Devoluzione/Testamento/Pubblicazione/DataPubblicazioneTestamento":
    {
      x: 488,
      top: 363,
      width: 71,
    },
  "xsd:/Fornitura/Dichiarazione/Frontespizio/TipoDichiarazione/Devoluzione/Testamento/Registrazione/UfficioDiRegistrazione":
    {
      x: 159,
      top: 387,
      width: 72,
    },
  "xsd:/Fornitura/Dichiarazione/Frontespizio/TipoDichiarazione/Devoluzione/Testamento/Registrazione/Serie":
    {
      x: 240,
      top: 387,
      width: 54,
    },
  "xsd:/Fornitura/Dichiarazione/Frontespizio/TipoDichiarazione/Devoluzione/Testamento/Registrazione/NumeroRegistrazione":
    {
      x: 302,
      top: 387,
      width: 82,
    },
  "xsd:/Fornitura/Dichiarazione/Frontespizio/TipoDichiarazione/Devoluzione/Testamento/Registrazione/SottonumeroRegistrazione":
    {
      x: 392,
      top: 387,
      width: 72,
    },
  "xsd:/Fornitura/Dichiarazione/Frontespizio/TipoDichiarazione/Devoluzione/Testamento/Registrazione/DataRegistrazione":
    {
      x: 488,
      top: 387,
      width: 71,
    },
  "xsd:/Fornitura/Dichiarazione/Frontespizio/Presentatore/CodiceFiscale": {
    x: 111,
    top: 411,
    width: 234,
  },
  "xsd:/Fornitura/Dichiarazione/Frontespizio/Presentatore/CodiceCarica": {
    x: 375,
    top: 411,
    width: 77,
  },
  "xsd:/Fornitura/Dichiarazione/Frontespizio/Presentatore/DecorrenzaTerminePresentazione": {
    x: 474,
    top: 411,
    width: 85,
  },
  "xsd:/Fornitura/Dichiarazione/Frontespizio/Presentatore/DatiAnagrafici/Cognome": {
    x: 111,
    top: 435,
    width: 210,
  },
  "xsd:/Fornitura/Dichiarazione/Frontespizio/Presentatore/DatiAnagrafici/Nome": {
    x: 330,
    top: 435,
    width: 205,
  },
  "xsd:/Fornitura/Dichiarazione/Frontespizio/Presentatore/DatiAnagrafici/Sesso": {
    x: 548,
    top: 435,
    width: 14,
    align: "center",
  },
  "xsd:/Fornitura/Dichiarazione/Frontespizio/Presentatore/DatiAnagrafici/DataNascita": {
    x: 111,
    top: 459,
    width: 104,
  },
  "xsd:/Fornitura/Dichiarazione/Frontespizio/Presentatore/DatiAnagrafici/ComuneNascita": {
    x: 218,
    top: 459,
    width: 292,
  },
  "xsd:/Fornitura/Dichiarazione/Frontespizio/Presentatore/DatiAnagrafici/ProvinciaNascita": {
    x: 522,
    top: 459,
    width: 38,
  },
  "xsd:/Fornitura/Dichiarazione/Frontespizio/Presentatore/Telefono": {
    x: 111,
    top: 483,
    width: 102,
  },
  "xsd:/Fornitura/Dichiarazione/Frontespizio/Presentatore/Email": {
    x: 218,
    top: 483,
    width: 342,
  },
  "xsd:/Fornitura/Dichiarazione/Frontespizio/Presentatore/CodiceFiscaleRappresentato": {
    x: 111,
    top: 507,
    width: 235,
  },
  "xsd:/Fornitura/Dichiarazione/Frontespizio/Presentatore/ResidenteEstero/StatoEstero": {
    x: 111,
    top: 531,
    width: 220,
  },
  "xsd:/Fornitura/Dichiarazione/Frontespizio/Presentatore/ResidenteEstero/CodiceStatoEstero": {
    x: 342,
    top: 531,
    width: 62,
  },
  "xsd:/Fornitura/Dichiarazione/Frontespizio/Presentatore/ResidenteEstero/StatoFederato": {
    x: 414,
    top: 531,
    width: 146,
  },
  "xsd:/Fornitura/Dichiarazione/Frontespizio/Presentatore/ResidenteEstero/LocalitaEstero": {
    x: 111,
    top: 555,
    width: 220,
  },
  "xsd:/Fornitura/Dichiarazione/Frontespizio/Presentatore/ResidenteEstero/IndirizzoEstero": {
    x: 342,
    top: 555,
    width: 218,
  },
  "xsd:/Fornitura/Dichiarazione/Frontespizio/CasiParticolari/CasiParticolari": {
    x: 321,
    top: 658,
    width: 12,
    kind: "checkbox",
  },
  "xsd:/Fornitura/Dichiarazione/Frontespizio/CasiParticolari/CopiaConforme": {
    x: 321,
    top: 691,
    width: 12,
    kind: "checkbox",
  },
  "xsd:/Fornitura/Dichiarazione/Frontespizio/ImpegnoATrasmettere/CFintermediario": {
    x: 111,
    top: 728,
    width: 245,
  },
  "xsd:/Fornitura/Dichiarazione/Frontespizio/ImpegnoATrasmettere/ImpegnoATrasmettere": {
    x: 548,
    top: 752,
    width: 12,
    kind: "checkbox",
  },
  "xsd:/Fornitura/Dichiarazione/Frontespizio/ImpegnoATrasmettere/DataImpegno": {
    x: 111,
    top: 789,
    width: 145,
  },
};

// Campi presenti nel tracciato tecnico e nelle descrizioni del controllo, ma
// assenti dalla pagina stampabile SRC-03. Non sono persi: restano nel modello
// canonico e nel DIZ, mentre il fac-simile non inventa per loro una casella.
const FACSIMILE_UNPRINTED_FIELDS = new Set([
  "xsd:/Fornitura/Dichiarazione/Frontespizio/IdentificativoProdSoftware",
  "xsd:/Fornitura/Dichiarazione/Frontespizio/Versamento/CodiceFiscaleTitolareCC",
  "xsd:/Fornitura/Dichiarazione/Frontespizio/Versamento/IBAN",
  "xsd:/Fornitura/Dichiarazione/Frontespizio/F24/Provincia",
  "xsd:/Fornitura/Dichiarazione/Frontespizio/F24/Comune",
  "xsd:/Fornitura/Dichiarazione/Frontespizio/F24/CodiceComune",
  "xsd:/Fornitura/Dichiarazione/Frontespizio/F24/Indirizzo",
  "xsd:/Fornitura/Dichiarazione/Frontespizio/ImportoDaVersare",
  "xsd:/Fornitura/Dichiarazione/Frontespizio/CampiServizio/Flag",
  "xsd:/Fornitura/Dichiarazione/Frontespizio/CampiServizio/Data",
  "xsd:/Fornitura/Dichiarazione/Frontespizio/CampiServizio/Flag2",
  "xsd:/Fornitura/Dichiarazione/Frontespizio/CampiServizio/Flag3",
  "xsd:/Fornitura/Dichiarazione/Frontespizio/Lingua",
]);

function isFacsimileUnprintedField(fieldId: string): boolean {
  if (FACSIMILE_UNPRINTED_FIELDS.has(fieldId)) return true;
  const field = getCatalogField(fieldId);
  if (!field) return false;
  return (
    (field.quadro === "EH" && field.technicalPath.endsWith("/Luogo/CodiceComune")) ||
    (field.quadro === "EI" && field.technicalPath.endsWith("/Luogo/CodiceComuneAmministrativo"))
  );
}

const STATIC_FIELD_PLACEMENTS = new Map<string, Placement>();
const registerStaticPlacements = (quadro: QuadroId, placements: Placement[]) => {
  const fields = listQuadroFields(quadro).filter((field) => field.visibleFieldId !== null);
  for (const [index, field] of fields.entries()) {
    const placement = placements[index];
    if (placement) STATIC_FIELD_PLACEMENTS.set(field.canonicalId, placement);
  }
};

registerStaticPlacements(
  "EE",
  [134, 146, 158, 170, 182, 194, 206, 218].map((top) => ({
    x: 505,
    top,
    width: 46,
    verticalOffset: -1.5,
    rightInset: 2,
  })),
);
const EF_FIELD_POSITIONS: Array<[number, number]> = [
  [410, 242],
  [495, 242],
  [410, 254],
  [495, 254],
  [410, 266],
  [495, 266],
  [410, 278],
  [495, 278],
  [367, 296],
  [410, 296],
  [495, 296],
  [495, 314],
  [495, 326],
  [495, 338],
  [495, 350],
  [410, 374],
  [495, 374],
  [495, 386],
  [410, 398],
  [495, 398],
  [495, 410],
  [495, 422],
  [495, 434],
  [495, 446],
  [410, 482],
  [495, 482],
  [363, 506],
  [454, 506],
  [495, 506],
  [495, 530],
  [214, 554],
  [242, 554],
  [327, 554],
  [412, 554],
  [495, 554],
  [326, 578],
  [370, 578],
  [412, 578],
  [548, 578],
  [495, 590],
  [410, 614],
  [495, 614],
  [410, 626],
  [495, 626],
  [410, 638],
  [495, 638],
  [410, 650],
  [495, 650],
  [410, 662],
  [495, 662],
  [410, 674],
  [495, 674],
];
registerStaticPlacements(
  "EF",
  EF_FIELD_POSITIONS.map(([x, top]) => ({
    x,
    top,
    width: x >= 490 ? 56 : x >= 400 ? 57 : 38,
    verticalOffset: -1.5,
    rightInset: 2,
  })),
);
registerStaticPlacements(
  "EG",
  [698, 710, 722, 734, 746, 758, 770, 782, 794, 806, 818].map((top) => ({
    x: 548,
    top,
    width: 12,
    verticalOffset: -1.5,
    align: "center",
  })),
);

const QUADRO_CHECKBOX_X: Partial<Record<QuadroId, number>> = {
  EA: 153,
  EB: 174,
  EC: 195,
  ER: 216,
  ED: 237,
  EE: 258,
  EF: 279,
  EG: 300,
  EH: 321,
  EI: 342,
  EL: 363,
  EM: 383,
  EN: 404,
  EO: 425,
  EP: 446,
  EQ: 467,
};

type LayoutAnchor = {
  number: string;
  page: number;
  x: number;
  top: number;
  width: number;
};

export interface OfficialFacsimileData {
  declaration: DeclarationSnapshot;
  revision: number;
  ready: boolean;
  generatedAt: string;
  digest: string;
  subjects: Array<{ id: string; sequence: number }>;
  assets: Array<{ id: string; quadro: QuadroId | null }>;
}

export class OfficialFacsimileError extends Error {
  readonly code: "SOURCE_MISMATCH" | "VERSION_MISMATCH" | "FIELD_UNMAPPED" | "VALUE_OVERFLOW";
  readonly fieldId: string | null;

  constructor(
    code: "SOURCE_MISMATCH" | "VERSION_MISMATCH" | "FIELD_UNMAPPED" | "VALUE_OVERFLOW",
    fieldId: string | null,
  ) {
    super(fieldId ? `${code}:${fieldId}` : code);
    this.code = code;
    this.fieldId = fieldId;
  }
}

function resolveOfficialModelPath(): string {
  const configured = process.env.SEQUENT_OFFICIAL_SOURCES_DIR;
  const candidates = [
    configured ? resolve(configured, facsimileLayout.sourceAlias) : null,
    resolve(process.cwd(), "private/official-sources", facsimileLayout.sourceAlias),
    resolve(process.cwd(), "official-sources", facsimileLayout.sourceAlias),
  ].filter((candidate): candidate is string => candidate !== null);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new OfficialFacsimileError("SOURCE_MISMATCH", null);
  return found;
}

function appliedFields(declaration: DeclarationSnapshot): CanonicalFieldValue[] {
  return Object.values(declaration.fields).filter(
    (field) =>
      APPLIED_STATES.has(field.state) &&
      field.value !== null &&
      field.value !== undefined &&
      String(field.value) !== "",
  );
}

function displayValue(value: unknown): string {
  return String(value ?? "").trim();
}

function fitText(font: PDFFont, value: string, width: number): number | null {
  for (let size = 8; size >= 5.2; size -= 0.2)
    if (font.widthOfTextAtSize(value, size) <= width) return size;
  return null;
}

function drawValue(
  page: PDFPage,
  font: PDFFont,
  fieldId: string,
  value: unknown,
  placement: Placement,
): void {
  const printable = displayValue(value);
  if (!printable || (placement.kind === "checkbox" && printable === "0")) return;
  if (placement.kind === "checkbox") {
    const verticalOffset = placement.verticalOffset ?? 0.7;
    page.drawText("X", {
      x: placement.x + Math.max(0, placement.width / 2 - 3),
      y: PAGE_HEIGHT - placement.top - verticalOffset - 8,
      size: 8,
      font,
      color: rgb(0.05, 0.05, 0.05),
    });
    return;
  }
  const verticalOffset = placement.verticalOffset ?? 3.5;
  const taxCode = /codice[-./:]?fiscale|CodiceFiscale/i.test(fieldId)
    ? /^([A-Z0-9]{16})$/.exec(printable.toUpperCase())
    : null;
  if (taxCode && placement.width >= 120) {
    const totalWidth = Math.min(placement.width, 230);
    const cellWidth = totalWidth / 16;
    const size = Math.min(7.5, cellWidth * 0.68);
    for (const [index, character] of [...taxCode[1]!].entries()) {
      const characterWidth = font.widthOfTextAtSize(character, size);
      page.drawText(character, {
        x: placement.x + index * cellWidth + (cellWidth - characterWidth) / 2,
        y: PAGE_HEIGHT - placement.top - verticalOffset - size,
        size,
        font,
        color: rgb(0.03, 0.03, 0.03),
      });
    }
    return;
  }
  const date = /^(\d{2})(\d{2})(\d{4})$/.exec(printable);
  if (date && placement.width >= 60) {
    const widths = [placement.width * 0.25, placement.width * 0.25, placement.width * 0.5];
    let x = placement.x;
    for (const [index, part] of date.slice(1).entries()) {
      const width = widths[index]!;
      const size = 7.2;
      const partWidth = font.widthOfTextAtSize(part, size);
      page.drawText(part, {
        x: x + (width - partWidth) / 2,
        y: PAGE_HEIGHT - placement.top - verticalOffset - size,
        size,
        font,
        color: rgb(0.03, 0.03, 0.03),
      });
      x += width;
    }
    return;
  }
  const size = fitText(font, printable, placement.width);
  if (size === null) throw new OfficialFacsimileError("VALUE_OVERFLOW", fieldId);
  const textWidth = font.widthOfTextAtSize(printable, size);
  const field = getCatalogField(fieldId);
  const monetaryOfficialField =
    /^\d+$/.test(printable) &&
    /(?:valore|importo|imposta|rendita|reddito|credito|sanzion|interess|acconto)/i.test(
      field?.label ?? "",
    );
  const x =
    placement.align === "center" || placement.width <= 38
      ? placement.x + Math.max(0, (placement.width - textWidth) / 2)
      : monetaryOfficialField
        ? placement.x + Math.max(0, placement.width - textWidth - (placement.rightInset ?? 25))
        : placement.x;
  page.drawText(printable, {
    x,
    y: PAGE_HEIGHT - placement.top - verticalOffset - size,
    size,
    font,
    color: rgb(0.03, 0.03, 0.03),
  });
}

function anchorsFor(quadro: QuadroId, number: string, sourcePage?: number): LayoutAnchor[] {
  if (quadro === "Frontespizio") return [];
  const layout = facsimileLayout.quadri[quadro as keyof typeof facsimileLayout.quadri];
  return (layout?.anchors ?? [])
    .filter((anchor) => anchor.number === number && (!sourcePage || anchor.page === sourcePage))
    .sort((left, right) => left.page - right.page || left.top - right.top || left.x - right.x);
}

function occurrenceGroup(field: ReturnType<typeof getCatalogField>): string | null {
  if (!field) return null;
  const path = field.technicalPath;
  const knownGroup = path.match(
    /\/(Devoluzione[A-Z]{2}\/Devoluzione|RipartizioneED\/Ripartizione|Graffati\/ImmobiliGraffati|ImmobiliAziendali)\//,
  )?.[1];
  return knownGroup ?? field.occurrenceGroup ?? null;
}

/**
 * SRC-03 numbers the printed boxes independently from the XSD sequence. This
 * resolver is deliberately explicit: a field without a verified printed box
 * returns null and therefore blocks the export instead of being guessed.
 */
export function resolveFacsimileFieldNumber(fieldId: string, occurrenceIndex = 0): string | null {
  const field = getCatalogField(fieldId);
  if (!field?.visibleNumber) return null;
  const number = Number(field.visibleNumber);
  const path = field.technicalPath;
  const ends = (suffix: string) => path.endsWith(suffix);
  const inside = (segment: string) => path.includes(segment);

  switch (field.quadro) {
    case "EH":
    case "EI":
      // La coordinata di EH/EI è risolta dalla mappa semantica esplicita per
      // pagina; il numero resta soltanto metadato ufficiale del campo.
      return specialFacsimilePlacement(fieldId, occurrenceIndex) ? field.visibleNumber : null;
    case "EB":
      if (ends("/CodiceComuneAmministrativo")) return null;
      if (ends("/ValorePrecSucc")) return "24";
      if (ends("/DiscordanzaDatiIntestatario")) return "25";
      if (ends("/PassaggiSenzaAttiLegali")) return "26";
      if (ends("/ImpostaVersataEstero")) return "27";
      if (inside("/DevoluzioneEB/Devoluzione/")) return String(number + 1);
      if (ends("/DevoluzioneEB/Continuazione")) return "36";
      break;
    case "EC":
      if (ends("/CodiceComuneAmministrativo")) return null;
      if (ends("/ValorePrecSucc")) return "26";
      if (ends("/DiscordanzaDatiIntestatario")) return "27";
      if (ends("/PassaggiSenzaAttiLegali")) return "28";
      if (ends("/DirittoAbitazione")) return "29";
      if (inside("/Graffati/ImmobiliGraffati/"))
        return occurrenceIndex <= 3 ? String(number + 2 + occurrenceIndex * 4) : null;
      if (ends("/Graffati/ContinuazioneGraffati")) return "46";
      if (inside("/DevoluzioneEC/Devoluzione/")) return String(number + 2);
      if (ends("/DevoluzioneEC/Continuazione")) return "55";
      break;
    case "ED":
      if (ends("/RipartizioneED/Ripartizione/Quota/QuotaValore")) return "15";
      if (ends("/RipartizioneED/Continuazione")) return "16";
      break;
    case "EL":
      if (ends("/CodiceComuneAmministrativo")) return null;
      if (ends("/SuperficieMetriQuadri")) return "15";
      if (number >= 15 && number <= 21) return String(number + 1);
      if (ends("/ValorePrecSucc")) return "23";
      if (ends("/PartitaTavolare")) return "24";
      if (ends("/CorpoTavolare")) return "25";
      break;
    case "EM":
      if (ends("/CodiceComuneAmministrativo")) return null;
      if (ends("/ValorePrecSucc")) return "26";
      if (ends("/DirittoAbitazione")) return "27";
      if (inside("/Graffati/ImmobiliGraffati/"))
        return occurrenceIndex <= 3 ? String(number + occurrenceIndex * 5) : null;
      break;
    case "EN":
      if (ends("/CodiceDiritto_P")) return "5";
      if (ends("/Aziende/Valore")) return "6";
      if (ends("/ValorePrecSucc")) return "7";
      if (ends("/BeneSitoEstero")) return "8";
      if (ends("/ImpostaVersataEstero")) return "9";
      if (inside("/ImmobiliAziendali/"))
        return occurrenceIndex <= 8 ? String(number - 1 + occurrenceIndex * 3) : null;
      if (ends("/ContinuazioneImmobiliAziendali")) return "37";
      if (inside("/DevoluzioneEN/Devoluzione/")) return String(number - 1);
      if (ends("/DevoluzioneEN/Continuazione")) return "46";
      break;
    case "EO":
      if (ends("/ValoreEsente")) return "12";
      if (ends("/ValorePrecSucc")) return "13";
      if (ends("/BeneSitoEstero")) return "14";
      if (ends("/ImpostaVersataEstero")) return "15";
      if (inside("/DevoluzioneEO/Devoluzione/")) return String(number + 2);
      if (ends("/DevoluzioneEO/Continuazione")) return "24";
      break;
    case "EP":
      if (ends("/ValorePrecSucc")) return "12";
      if (inside("/DevoluzioneEP/Devoluzione/")) return String(number + 1);
      if (ends("/DevoluzioneEP/Continuazione")) return "21";
      break;
    case "EQ":
      if (ends("/ValorePrecSucc")) return "15";
      if (inside("/DevoluzioneEQ/Devoluzione/")) return String(number + 1);
      if (ends("/DevoluzioneEQ/Continuazione")) return "24";
      break;
    case "ER":
      if (ends("/ValorePrecSucc")) return "9";
      if (inside("/DevoluzioneER/Devoluzione/")) return String(number + 1);
      if (ends("/DevoluzioneER/Continuazione")) return "18";
      break;
  }
  return field.visibleNumber;
}

type ResolvedPlacement = Placement & { page: number };

function mappedPlacement(
  quadro: QuadroId,
  fieldId: string,
  printedNumber: string,
  sourcePage: number,
  slot: number,
  occurrenceIndex: number,
): ResolvedPlacement | null {
  const specialPlacement = specialFacsimilePlacement(fieldId, occurrenceIndex);
  if (specialPlacement) return specialPlacement;
  const staticPlacement = STATIC_FIELD_PLACEMENTS.get(fieldId);
  if (staticPlacement)
    return {
      page: sourcePage,
      ...staticPlacement,
    };
  const field = getCatalogField(fieldId);
  if (!field) return null;
  if (field.entityScope === "subject" || field.entityScope === "asset") {
    const anchors = anchorsFor(quadro, printedNumber, sourcePage);
    if (anchors.length === 0) return null;
    const capacity = ASSET_CAPACITY[quadro] ?? 1;
    const anchorsPerSlot = Math.max(1, Math.floor(anchors.length / capacity));
    const repeatedRows =
      /\/(?:Devoluzione[A-Z]{2}\/Devoluzione|RipartizioneED\/Ripartizione)\//.test(
        field.technicalPath,
      );
    const row = repeatedRows ? occurrenceIndex : 0;
    return anchors[slot * anchorsPerSlot + row] ?? null;
  }
  const anchors = anchorsFor(quadro, printedNumber);
  if (anchors.length === 0) return null;
  const siblings = listQuadroFields(quadro).filter(
    (candidate) =>
      resolveFacsimileFieldNumber(candidate.canonicalId) === printedNumber &&
      candidate.visibleFieldId !== null &&
      candidate.entityScope === field.entityScope &&
      (candidate.occurrenceGroup ?? null) === (field.occurrenceGroup ?? null),
  );
  const rank = siblings.findIndex((candidate) => candidate.canonicalId === fieldId);
  if (rank < 0) return null;
  return anchors[rank + occurrenceIndex * siblings.length] ?? null;
}

function isSignatureField(fieldId: string): boolean {
  return /\/Firma|\.firma/i.test(fieldId);
}

function pageMarking(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  data: OfficialFacsimileData,
  pageNumber: number,
  totalPages: number,
): void {
  const label = `${data.ready ? "FAC-SIMILE" : "FAC-SIMILE - BOZZA"} - NON TRASMETTIBILE`;
  const labelWidth = bold.widthOfTextAtSize(label, 7.2);
  page.drawRectangle({
    x: PAGE_WIDTH - labelWidth - 27,
    y: PAGE_HEIGHT - 17,
    width: labelWidth + 20,
    height: 13,
    color: rgb(1, 1, 1),
    opacity: 0.9,
  });
  page.drawText(label, {
    x: PAGE_WIDTH - labelWidth - 17,
    y: PAGE_HEIGHT - 13,
    size: 7.2,
    font: bold,
    color: rgb(0.68, 0.08, 0.08),
  });
  const footer = `Sequent - revisione ${data.revision} - ${data.generatedAt.slice(0, 10)} - ${pageNumber}/${totalPages}`;
  page.drawRectangle({ x: 22, y: 3, width: 265, height: 11, color: rgb(1, 1, 1), opacity: 0.9 });
  page.drawText(footer, { x: 27, y: 6, size: 6.2, font: regular, color: rgb(0.33, 0.33, 0.33) });
}

function derivedFrontValues(data: OfficialFacsimileData, activeQuadri: Set<QuadroId>) {
  const counts: Record<string, number> = {};
  for (const subject of data.subjects) {
    const type = getCanonicalField(data.declaration, "quadro-ea.soggetto.tipo", subject.id)?.value;
    if (type !== null && type !== undefined && String(type) !== "")
      counts[String(type)] = (counts[String(type)] ?? 0) + 1;
  }
  const values = new Map<string, string>();
  for (const field of listQuadroFields("Frontespizio")) {
    if (!field.derivedFrom) continue;
    const value = deriveOfficialFieldValue(field.derivedFrom, {
      declarationKind: data.declaration.declarationKind,
      quadroEaTypeCounts: counts,
    });
    if (value) values.set(field.canonicalId, value);
  }
  for (const [quadro, x] of Object.entries(QUADRO_CHECKBOX_X) as Array<[QuadroId, number]>)
    if (activeQuadri.has(quadro))
      values.set(`facsimile:quadro:${quadro}`, JSON.stringify({ value: "1", x }));
  return values;
}

function activeContexts(data: OfficialFacsimileData, fields: CanonicalFieldValue[]) {
  const byQuadro = new Map<QuadroId, string[]>();
  byQuadro.set(
    "EA",
    [...data.subjects]
      .sort((left, right) => left.sequence - right.sequence)
      .map((subject) => subject.id),
  );
  for (const asset of data.assets) {
    if (!asset.quadro) continue;
    const contexts = byQuadro.get(asset.quadro) ?? [];
    contexts.push(asset.id);
    byQuadro.set(asset.quadro, contexts);
  }
  for (const fieldValue of fields) {
    const field = getCatalogField(fieldValue.fieldId);
    const quadro = field?.quadro as QuadroId | undefined;
    if (!quadro || quadro === "Frontespizio" || ENTITY_QUADRI.has(quadro)) continue;
    if (!byQuadro.has(quadro)) byQuadro.set(quadro, ["declaration"]);
  }
  return byQuadro;
}

export async function createOfficialFacsimilePdf(data: OfficialFacsimileData): Promise<Uint8Array> {
  if (
    data.declaration.officialSourceBundleId !== OFFICIAL_SOURCE_BUNDLE_ID ||
    data.declaration.catalogVersion !== CURRENT_CATALOG_VERSION ||
    data.declaration.rulesetVersion !== CURRENT_RULESET_VERSION
  )
    throw new OfficialFacsimileError("VERSION_MISMATCH", null);

  const sourcePath = resolveOfficialModelPath();
  const sourceBytes = readFileSync(sourcePath);
  const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  if (sourceSha256 !== facsimileLayout.sourceSha256)
    throw new OfficialFacsimileError("SOURCE_MISMATCH", null);

  const values = appliedFields(data.declaration);
  for (const value of values) {
    const field = getCatalogField(value.fieldId);
    if (
      !field ||
      field.presentation === "technical-only" ||
      isFacsimileUnprintedField(value.fieldId) ||
      isSignatureField(value.fieldId)
    )
      continue;
    if (field.quadro === "Frontespizio" && !FRONT_FIELDS[value.fieldId])
      throw new OfficialFacsimileError("FIELD_UNMAPPED", value.fieldId);
    if (
      field.quadro !== "Frontespizio" &&
      (!field.visibleNumber || resolveFacsimileFieldNumber(value.fieldId) === null)
    )
      throw new OfficialFacsimileError("FIELD_UNMAPPED", value.fieldId);
    if (
      (field.quadro === "EH" || field.quadro === "EI") &&
      field.technicalPath.includes("/Modulo/") &&
      !field.technicalPath.includes("/PrimoModulo/") &&
      value.occurrenceId === null
    )
      throw new OfficialFacsimileError("FIELD_UNMAPPED", value.fieldId);
  }

  const contexts = activeContexts(data, values);
  for (const value of values) {
    const field = getCatalogField(value.fieldId);
    const quadro = field?.quadro as QuadroId | undefined;
    if (
      !quadro ||
      quadro === "Frontespizio" ||
      (field?.entityScope !== "subject" && field?.entityScope !== "asset")
    )
      continue;
    if (!value.entityId || !(contexts.get(quadro) ?? []).includes(value.entityId))
      throw new OfficialFacsimileError("FIELD_UNMAPPED", value.fieldId);
  }
  const activeQuadri = new Set<QuadroId>(
    [...contexts.entries()].filter(([, entries]) => entries.length > 0).map(([quadro]) => quadro),
  );
  const source = await PDFDocument.load(sourceBytes);
  const output = await PDFDocument.create();
  output.registerFontkit(fontkit);
  const regular = await output.embedFont(REGULAR_FONT, { subset: false });
  const bold = await output.embedFont(BOLD_FONT, { subset: false });
  output.setTitle(`Fac-simile dichiarazione - revisione ${data.revision}`);
  output.setAuthor("Sequent");
  output.setSubject("Fac-simile non trasmettibile del modello ufficiale di successione");
  output.setCreationDate(new Date(data.generatedAt));
  output.setKeywords([
    "fac-simile",
    "non trasmettibile",
    `revisione ${data.revision}`,
    facsimileLayout.sourceId,
    data.digest,
  ]);

  type PlannedPage = {
    sourcePage: number;
    quadri: QuadroId[];
    chunk: number;
    moduleId: string | null;
  };
  const plan: PlannedPage[] = [
    { sourcePage: 2, quadri: ["Frontespizio"], chunk: 0, moduleId: null },
  ];
  const handledSharedPages = new Set<number>();
  for (const [quadro, entries] of contexts) {
    if (entries.length === 0) continue;
    const pages = SOURCE_PAGES[quadro];
    const shared = pages.length === 1 && [8, 18].includes(pages[0]!);
    if (shared) {
      const sourcePage = pages[0]!;
      if (handledSharedPages.has(sourcePage)) continue;
      handledSharedPages.add(sourcePage);
      const pageQuadri =
        sourcePage === 8 ? (["EE", "EF", "EG"] as QuadroId[]) : (["EP", "EQ"] as QuadroId[]);
      const copies = Math.max(
        1,
        ...pageQuadri.map((candidate) =>
          Math.ceil((contexts.get(candidate)?.length ?? 0) / (ASSET_CAPACITY[candidate] ?? 1)),
        ),
      );
      for (let chunk = 0; chunk < copies; chunk += 1)
        plan.push({ sourcePage, quadri: pageQuadri, chunk, moduleId: null });
      continue;
    }
    if (quadro === "EH" || quadro === "EI") {
      const additionalModuleIds = [
        ...new Set(
          values
            .filter((value) => {
              const field = getCatalogField(value.fieldId);
              return (
                field?.quadro === quadro &&
                field.technicalPath.includes("/Modulo/") &&
                !field.technicalPath.includes("/PrimoModulo/")
              );
            })
            .map((value) => value.occurrenceId)
            .filter((id): id is string => id !== null),
        ),
      ];
      for (const [chunk, moduleId] of [null, ...additionalModuleIds].entries())
        for (const sourcePage of pages)
          plan.push({ sourcePage, quadri: [quadro], chunk, moduleId });
      continue;
    }
    if (pages.length > 1) {
      for (const sourcePage of pages)
        plan.push({ sourcePage, quadri: [quadro], chunk: 0, moduleId: null });
      continue;
    }
    const capacity = ASSET_CAPACITY[quadro] ?? 1;
    const copies = Math.max(1, Math.ceil(entries.length / capacity));
    for (let chunk = 0; chunk < copies; chunk += 1)
      plan.push({ sourcePage: pages[0]!, quadri: [quadro], chunk, moduleId: null });
  }
  plan.sort((left, right) => {
    const leftBase = Math.min(...left.quadri.flatMap((quadro) => SOURCE_PAGES[quadro]));
    const rightBase = Math.min(...right.quadri.flatMap((quadro) => SOURCE_PAGES[quadro]));
    return leftBase - rightBase || left.chunk - right.chunk || left.sourcePage - right.sourcePage;
  });

  for (const planned of plan) {
    const [page] = await output.copyPages(source, [planned.sourcePage - 1]);
    if (!page) throw new OfficialFacsimileError("SOURCE_MISMATCH", null);
    output.addPage(page);
    if (planned.sourcePage === 2) {
      const derived = derivedFrontValues(data, activeQuadri);
      for (const [fieldId, value] of derived) {
        if (fieldId.startsWith("facsimile:quadro:")) {
          const parsed = JSON.parse(value) as { value: string; x: number };
          drawValue(page, regular, fieldId, parsed.value, {
            x: parsed.x,
            top: 580,
            width: 12,
            kind: "checkbox",
          });
          continue;
        }
        const placement = FRONT_FIELDS[fieldId];
        if (placement)
          drawValue(page, regular, fieldId, value, {
            ...placement,
            verticalOffset: placement.verticalOffset ?? -1.5,
          });
      }
      for (const value of values) {
        const field = getCatalogField(value.fieldId);
        if (
          field?.quadro !== "Frontespizio" ||
          field.presentation === "technical-only" ||
          isFacsimileUnprintedField(value.fieldId)
        )
          continue;
        if (isSignatureField(value.fieldId)) continue;
        const placement = FRONT_FIELDS[value.fieldId]!;
        drawValue(page, regular, value.fieldId, value.value, {
          ...placement,
          verticalOffset: placement.verticalOffset ?? -1.5,
        });
      }
      continue;
    }

    for (const quadro of planned.quadri) {
      const capacity = ASSET_CAPACITY[quadro] ?? 1;
      const quadroContexts = contexts.get(quadro) ?? ["declaration"];
      const chunkContexts = ENTITY_QUADRI.has(quadro)
        ? quadroContexts.slice(planned.chunk * capacity, (planned.chunk + 1) * capacity)
        : quadroContexts;
      for (const value of values) {
        const field = getCatalogField(value.fieldId);
        if (
          field?.quadro !== quadro ||
          field.presentation === "technical-only" ||
          isFacsimileUnprintedField(value.fieldId)
        )
          continue;
        if (!field.visibleNumber || isSignatureField(value.fieldId)) continue;
        if (quadro === "EH" || quadro === "EI") {
          const additionalModule =
            field.technicalPath.includes("/Modulo/") &&
            !field.technicalPath.includes("/PrimoModulo/");
          if (planned.moduleId === null ? additionalModule : !additionalModule) continue;
          if (planned.moduleId !== null && value.occurrenceId !== planned.moduleId) continue;
        }
        const slot =
          field.entityScope === "subject" || field.entityScope === "asset"
            ? chunkContexts.indexOf(value.entityId ?? "")
            : 0;
        if (slot < 0) continue;
        const group = occurrenceGroup(field);
        const occurrenceIds = group
          ? [
              ...new Set(
                values
                  .filter((candidate) => {
                    const candidateField = getCatalogField(candidate.fieldId);
                    return (
                      candidateField?.quadro === quadro &&
                      occurrenceGroup(candidateField) === group &&
                      candidate.entityId === value.entityId
                    );
                  })
                  .map((candidate) => candidate.occurrenceId)
                  .filter((id): id is string => id !== null),
              ),
            ]
          : [];
        const occurrenceIndex = value.occurrenceId
          ? Math.max(0, occurrenceIds.indexOf(value.occurrenceId))
          : 0;
        const printedNumber = resolveFacsimileFieldNumber(value.fieldId, occurrenceIndex);
        if (printedNumber === null)
          throw new OfficialFacsimileError("FIELD_UNMAPPED", value.fieldId);
        const placement = mappedPlacement(
          quadro,
          value.fieldId,
          printedNumber,
          planned.sourcePage,
          slot,
          occurrenceIndex,
        );
        if (!placement) throw new OfficialFacsimileError("FIELD_UNMAPPED", value.fieldId);
        if (placement.page !== planned.sourcePage) continue;
        drawValue(page, regular, value.fieldId, value.value, {
          ...placement,
          kind: placement.kind ?? (field.control === "checkbox" ? "checkbox" : "text"),
          verticalOffset: placement.verticalOffset ?? 3.5,
        });
      }
    }
  }

  const pages = output.getPages();
  for (const [index, page] of pages.entries()) {
    const decedentTaxCode = values.find(
      (value) => value.fieldId === "frontespizio.defunto.codice-fiscale",
    )?.value;
    if (index > 0 && decedentTaxCode) {
      const sourcePage = plan[index]?.sourcePage;
      const continuationHeader = sourcePage !== undefined && [10, 11, 12].includes(sourcePage);
      drawValue(
        page,
        regular,
        "frontespizio.defunto.codice-fiscale",
        decedentTaxCode,
        continuationHeader ? { x: 110, top: 28, width: 168 } : { x: 246, top: 63, width: 315 },
      );
    }
    pageMarking(page, regular, bold, data, index + 1, pages.length);
  }
  return output.save();
}
