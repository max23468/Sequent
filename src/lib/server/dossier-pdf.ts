import fontkit from "@pdf-lib/fontkit";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export interface DossierPdfData {
  title: string;
  declarationLabel: string;
  revision: number;
  successionDate: string | null;
  generatedAt: string;
  ready: boolean;
  digest: string;
  officialSourceLabel: string;
  qualification: {
    quadriPresent: string[];
    officialControl: { name: string; version: string; blockingDiagnostics: number };
    attachments: {
      files: number;
      totalBytes: number;
      formats: string[];
      motivatedExceptions: number;
    };
  };
  subjects: Array<{ name: string; role: string; taxCode: string | null }>;
  assets: Array<{ name: string; kind: string; valueCents: string; quadro: string | null }>;
  shares: Array<{
    asset: string;
    beneficiary: string;
    numerator: string;
    denominator: string;
    valueCents: string;
  }>;
  calculation: null | {
    totalTaxCents: string;
    taxSummary: {
      totalAssetsCents: string;
      totalLiabilitiesCents: string;
      netEstateCents: string;
      mortgageTaxCents: string;
      cadastralTaxCents: string;
      relatedTaxesCents: string;
      successionTaxCents: string;
      penaltiesAndInterestCents: string;
      totalAtSubmissionCents: string;
    };
    beneficiaries: Array<{
      beneficiary: string;
      netEstateCents: string;
      allowanceCents: string;
      grossTaxCents: string;
      netTaxCents: string;
    }>;
  };
  checklist: Array<{ label: string; status: string }>;
  issues: Array<{ message: string; sourceId: string }>;
}

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 52;
const BODY_SIZE = 9.5;
const MUTED = rgb(0.32, 0.37, 0.42);
const NAVY = rgb(0.08, 0.17, 0.25);
const TEAL = rgb(0.05, 0.45, 0.47);
const require = createRequire(import.meta.url);
const REGULAR_FONT = readFileSync(
  require.resolve("@expo-google-fonts/noto-sans/400Regular/NotoSans_400Regular.ttf"),
);
const BOLD_FONT = readFileSync(
  require.resolve("@expo-google-fonts/noto-sans/700Bold/NotoSans_700Bold.ttf"),
);

function safeText(value: unknown): string {
  return (
    String(value ?? "")
      .normalize("NFC")
      // oxlint-disable-next-line no-control-regex -- I caratteri di controllo non sono ammessi nel testo PDF.
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
  );
}

function money(value: string): string {
  const cents = BigInt(value);
  const absolute = cents < 0n ? -cents : cents;
  const euros = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${cents < 0n ? "-" : ""}${euros},${(absolute % 100n).toString().padStart(2, "0")} EUR`;
}

function bytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(2).replace(".", ",")} MB`;
}

function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of safeText(text).split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      if (font.widthOfTextAtSize(word, size) <= width) {
        line = word;
        continue;
      }
      let part = "";
      for (const character of word) {
        const candidatePart = `${part}${character}`;
        if (part && font.widthOfTextAtSize(candidatePart, size) > width) {
          lines.push(part);
          part = character;
        } else part = candidatePart;
      }
      line = part;
    }
    lines.push(line);
  }
  return lines.length > 0 ? lines : [""];
}

export async function createDossierPdf(data: DossierPdfData): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  document.setTitle(`Dossier - ${safeText(data.title)}`);
  document.setAuthor("Sequent");
  document.setSubject("Riepilogo della dichiarazione di successione");
  document.setCreationDate(new Date(data.generatedAt));
  const regular = await document.embedFont(REGULAR_FONT, { subset: false });
  const bold = await document.embedFont(BOLD_FONT, { subset: false });
  let page: PDFPage = document.addPage([A4.width, A4.height]);
  let y = A4.height - MARGIN;

  const preparePage = () => {
    y = A4.height - MARGIN - 48;
  };

  const drawPageHeader = (targetPage: PDFPage) => {
    const headerY = A4.height - MARGIN;
    targetPage.drawText("SEQUENT", { x: MARGIN, y: headerY, size: 8, font: bold, color: TEAL });
    targetPage.drawText("Dossier della pratica", {
      x: A4.width - MARGIN - 104,
      y: headerY,
      size: 8,
      font: regular,
      color: MUTED,
    });
    targetPage.drawLine({
      start: { x: MARGIN, y: headerY - 24 },
      end: { x: A4.width - MARGIN, y: headerY - 24 },
      thickness: 1.2,
      color: NAVY,
    });
  };

  const newPage = () => {
    page = document.addPage([A4.width, A4.height]);
    preparePage();
  };

  const ensure = (height: number) => {
    if (y - height < MARGIN + 24) newPage();
  };

  const text = (
    value: string,
    options: {
      size?: number;
      font?: PDFFont;
      color?: ReturnType<typeof rgb>;
      indent?: number;
      width?: number;
      after?: number;
    } = {},
  ) => {
    const size = options.size ?? BODY_SIZE;
    const selectedFont = options.font ?? regular;
    const indent = options.indent ?? 0;
    const lineHeight = size * 1.38;
    const lines = wrap(selectedFont, value, size, options.width ?? A4.width - MARGIN * 2 - indent);
    ensure(lines.length * lineHeight + (options.after ?? 0));
    for (const line of lines) {
      page.drawText(line, {
        x: MARGIN + indent,
        y,
        size,
        font: selectedFont,
        color: options.color ?? NAVY,
      });
      y -= lineHeight;
    }
    y -= options.after ?? 0;
  };

  const section = (title: string) => {
    ensure(34);
    y -= 14;
    page.drawText(safeText(title), { x: MARGIN, y, size: 13.5, font: bold, color: NAVY });
    page.drawLine({
      start: { x: MARGIN, y: y - 6 },
      end: { x: A4.width - MARGIN, y: y - 6 },
      thickness: 0.45,
      color: rgb(0.76, 0.8, 0.82),
    });
    y -= 13;
  };

  const row = (label: string, value: string, labelWidth = 170, valueFont = bold) => {
    const lineHeight = BODY_SIZE * 1.38;
    const columnGap = 14;
    const labelLines = wrap(regular, label, BODY_SIZE, labelWidth - columnGap);
    const valueLines = wrap(valueFont, value, BODY_SIZE, A4.width - MARGIN * 2 - labelWidth);
    const lineCount = Math.max(1, labelLines.length, valueLines.length);
    ensure(lineCount * lineHeight + 3);
    for (const [index, line] of labelLines.entries()) {
      page.drawText(line, {
        x: MARGIN,
        y: y - index * lineHeight,
        size: BODY_SIZE,
        font: regular,
        color: MUTED,
      });
    }
    for (const [index, line] of valueLines.entries()) {
      page.drawText(line, {
        x: MARGIN + labelWidth,
        y: y - index * lineHeight,
        size: BODY_SIZE,
        font: valueFont,
        color: NAVY,
      });
    }
    y -= lineCount * lineHeight + 3;
  };

  const item = (title: string, detail: string) => {
    ensure(34);
    text(title, { size: 10, font: bold, after: 1 });
    text(detail, { size: 8.4, color: MUTED, after: 7 });
  };

  preparePage();
  text(data.title, { size: 22, font: bold, after: 2 });
  text("Riepilogo della dichiarazione", { size: 10.5, color: MUTED, after: 14 });
  const statusLabel = data.ready
    ? "Controlli disponibili superati"
    : "Bozza - controlli da completare";
  ensure(38);
  page.drawRectangle({
    x: MARGIN,
    y: y - 18,
    width: A4.width - MARGIN * 2,
    height: 36,
    color: data.ready ? rgb(0.9, 0.97, 0.94) : rgb(0.99, 0.95, 0.86),
  });
  page.drawText(statusLabel, { x: MARGIN + 13, y: y - 1, size: 10, font: bold, color: NAVY });
  y -= 39;

  section("Dichiarazione");
  row("Tipo", data.declarationLabel);
  row("Revisione", String(data.revision));
  row("Data di apertura", data.successionDate ?? "Non indicata");
  row("Dossier generato", data.generatedAt.slice(0, 10));

  section("Verifica delle fonti e dei documenti");
  row("Fonti di riferimento", data.officialSourceLabel);
  row("Quadri compilati", data.qualification.quadriPresent.join(", ") || "Nessuno");
  row(
    "Controllo dell'Agenzia",
    `Versione ${data.qualification.officialControl.version} - ${data.qualification.officialControl.blockingDiagnostics === 0 ? "la pratica di prova non presenta errori bloccanti" : `${data.qualification.officialControl.blockingDiagnostics} errori bloccanti`}`,
  );
  row(
    "Allegati preparati",
    `${data.qualification.attachments.files} file - ${bytes(data.qualification.attachments.totalBytes)}${data.qualification.attachments.formats.length ? ` - ${data.qualification.attachments.formats.join(", ")}` : ""}`,
  );
  row("Eccezioni motivate", String(data.qualification.attachments.motivatedExceptions));

  section("Soggetti");
  if (data.subjects.length === 0) text("Nessun soggetto registrato.", { color: MUTED, after: 4 });
  for (const subject of data.subjects)
    item(subject.name, `${subject.role}${subject.taxCode ? ` · ${subject.taxCode}` : ""}`);

  section("Beni e passività");
  if (data.assets.length === 0)
    text("Nessun bene o passività registrato.", { color: MUTED, after: 4 });
  for (const asset of data.assets)
    item(
      asset.name,
      `${asset.kind} · ${money(asset.valueCents)}${asset.quadro ? ` · Quadro ${asset.quadro}` : ""}`,
    );

  section("Devoluzione");
  if (data.shares.length === 0)
    text("La devoluzione non è ancora stata confermata.", { color: MUTED, after: 4 });
  for (const share of data.shares)
    item(
      share.asset,
      `${share.beneficiary} · quota ${share.numerator}/${share.denominator} · ${money(share.valueCents)}`,
    );

  section("Calcolo dell'imposta");
  if (!data.calculation)
    text("Il calcolo non è ancora stato confermato.", { color: MUTED, after: 4 });
  else {
    ensure(57);
    y -= 18;
    page.drawRectangle({
      x: MARGIN,
      y: y - 18,
      width: A4.width - MARGIN * 2,
      height: 35,
      color: rgb(0.94, 0.97, 0.97),
    });
    page.drawText("Imposta complessiva", {
      x: MARGIN + 12,
      y: y - 1,
      size: 9,
      font: regular,
      color: MUTED,
    });
    const total = money(data.calculation.totalTaxCents);
    page.drawText(total, {
      x: A4.width - MARGIN - 12 - bold.widthOfTextAtSize(total, 11),
      y: y - 2,
      size: 11,
      font: bold,
      color: NAVY,
    });
    y -= 44;
    ensure(170);
    text("Riepilogo della dichiarazione", { size: 10.5, font: bold, after: 5 });
    row("Attivo", money(data.calculation.taxSummary.totalAssetsCents), 250);
    row("Passivo", money(data.calculation.taxSummary.totalLiabilitiesCents), 250);
    row("Asse ereditario netto", money(data.calculation.taxSummary.netEstateCents), 250);
    row("Imposta ipotecaria", money(data.calculation.taxSummary.mortgageTaxCents), 250);
    row("Imposta catastale", money(data.calculation.taxSummary.cadastralTaxCents), 250);
    row(
      "Servizi, bollo e tributi speciali",
      money(data.calculation.taxSummary.relatedTaxesCents),
      250,
    );
    row(
      "Imposta di successione dovuta",
      money(data.calculation.taxSummary.successionTaxCents),
      250,
    );
    row("Sanzioni e interessi", money(data.calculation.taxSummary.penaltiesAndInterestCents), 250);
    row(
      "Da versare con la dichiarazione",
      money(data.calculation.taxSummary.totalAtSubmissionCents),
      250,
      bold,
    );
    y -= 7;
    for (const result of data.calculation.beneficiaries) {
      ensure(98);
      text(result.beneficiary, { size: 10.5, font: bold, after: 5 });
      row("Attivo netto", money(result.netEstateCents), 145);
      row("Franchigia", money(result.allowanceCents), 145);
      row("Imposta lorda", money(result.grossTaxCents), 145);
      row("Imposta netta", money(result.netTaxCents), 145);
      y -= 5;
    }
  }

  section("Documenti richiesti");
  if (data.checklist.length === 0)
    text("Nessun documento richiesto per i dati inseriti.", { color: MUTED, after: 4 });
  for (const checklistItem of data.checklist)
    row(checklistItem.label, checklistItem.status, 365, regular);

  section("Controlli");
  if (data.issues.length === 0)
    text("Nessun problema rilevato dai controlli disponibili.", { after: 4 });
  for (const issue of data.issues) item(issue.message, `Fonte ${issue.sourceId}`);

  section("Tracciabilità");
  text(`Codice di verifica`, { size: 7.5, font: bold, color: MUTED, after: 2 });
  text(data.digest, { size: 7.2, color: MUTED, after: 7 });
  text(`Fonti ministeriali`, { size: 7.5, font: bold, color: MUTED, after: 2 });
  text(data.officialSourceLabel, { size: 7.2, color: MUTED });

  const pages = document.getPages();
  for (const [index, currentPage] of pages.entries()) {
    drawPageHeader(currentPage);
    const label = `${index + 1} / ${pages.length}`;
    currentPage.drawText(label, {
      x: A4.width - MARGIN - regular.widthOfTextAtSize(label, 7.5),
      y: 25,
      size: 7.5,
      font: regular,
      color: MUTED,
    });
  }
  return document.save();
}
