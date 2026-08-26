import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { copyFile, mkdir, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { persistGeneratedArtifact, resolveBlobPath } from "./blob-store.ts";
import { getDataDirectory } from "./config.ts";
import {
  addDocumentArtifact,
  createReviewItem,
  getDocument,
  replaceDocumentPages,
  updateDocumentProcessing,
  type ExtractedPage,
} from "./documents.ts";
import { readToolVersion, runCommand, type CommandRunner } from "./process-tools.ts";

const MAX_TEXT_BYTES = 20 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set([
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".heic",
  ".tif",
  ".tiff",
  ".webp",
  ".xml",
  ".xlsx",
  ".xls",
  ".csv",
  ".ods",
  ".docx",
  ".doc",
  ".odt",
  ".rtf",
  ".txt",
  ".zip",
  ".diz",
  ".p7m",
]);

type DetectedKind = "pdf" | "image" | "structured" | "office" | "archive" | "signed" | "opaque";

interface FormatDetection {
  format: string;
  kind: DetectedKind;
  extension: string;
}

interface ProcessResult {
  pages: ExtractedPage[];
  detectedFormat: string;
  language: string | null;
  status: "processed" | "to_review" | "unsupported" | "unreadable";
}

async function readPrefix(path: string, length = 16): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function detectFormat(originalName: string, mediaType: string, prefix: Buffer): FormatDetection {
  const extension = extname(originalName).toLowerCase();
  if (prefix.subarray(0, 5).toString("ascii") === "%PDF-")
    return { format: "PDF", kind: "pdf", extension: ".pdf" };
  if (prefix.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return { format: "PNG", kind: "image", extension: ".png" };
  if (prefix[0] === 0xff && prefix[1] === 0xd8)
    return { format: "JPEG", kind: "image", extension: ".jpg" };
  if (["II*\0", "MM\0*"].includes(prefix.subarray(0, 4).toString("latin1")))
    return { format: "TIFF", kind: "image", extension: ".tiff" };
  if (
    prefix.subarray(0, 4).toString("ascii") === "RIFF" &&
    prefix.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return { format: "WebP", kind: "image", extension: ".webp" };
  if ([".jpg", ".jpeg", ".png", ".heic", ".tif", ".tiff", ".webp"].includes(extension))
    return { format: extension.slice(1).toUpperCase(), kind: "image", extension };
  if ([".doc", ".docx", ".odt", ".rtf", ".xls", ".xlsx", ".ods"].includes(extension))
    return { format: extension.slice(1).toUpperCase(), kind: "office", extension };
  if ([".xml", ".csv", ".txt"].includes(extension) || mediaType.startsWith("text/"))
    return {
      format: extension.slice(1).toUpperCase() || "TEXT",
      kind: "structured",
      extension: extension || ".txt",
    };
  if ([".zip", ".diz"].includes(extension) || prefix.subarray(0, 2).toString("latin1") === "PK")
    return {
      format: extension === ".diz" ? "DIZ" : "ZIP",
      kind: "archive",
      extension: extension || ".zip",
    };
  if (extension === ".p7m") return { format: "P7M", kind: "signed", extension };
  return {
    format: extension ? extension.slice(1).toUpperCase() : "SCONOSCIUTO",
    kind: "opaque",
    extension,
  };
}

async function readTextLimited(path: string): Promise<string> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(MAX_TEXT_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, MAX_TEXT_BYTES, 0);
    return buffer.subarray(0, bytesRead).toString("utf8").replaceAll("\0", "");
  } finally {
    await handle.close();
  }
}

function splitTextPages(text: string, method: ExtractedPage["method"]): ExtractedPage[] {
  const chunks = text.split("\f");
  if (chunks.length > 1 && chunks.at(-1)?.trim() === "") chunks.pop();
  return (chunks.length === 0 ? [""] : chunks).map((chunk, index) => ({
    pageNumber: index + 1,
    text: chunk.trim(),
    confidence: method === "ocr" ? null : 1,
    language: "it",
    method,
  }));
}

function needsPdfOcr(text: string): boolean {
  const pages = text.split("\f");
  if (pages.length > 1 && pages.at(-1)?.trim() === "") pages.pop();
  return pages.some((page) => page.replaceAll(/\s/g, "").length < 20);
}

function decodeXmlText(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

function parsePdfBbox(html: string, method: ExtractedPage["method"]): ExtractedPage[] {
  const pages: ExtractedPage[] = [];
  const pagePattern = /<page\b[^>]*>([\s\S]*?)<\/page>/gi;
  for (const pageMatch of html.matchAll(pagePattern)) {
    const coordinates: unknown[] = [];
    const words: string[] = [];
    const wordPattern =
      /<word\s+xMin="([^"]+)"\s+yMin="([^"]+)"\s+xMax="([^"]+)"\s+yMax="([^"]+)">([\s\S]*?)<\/word>/gi;
    for (const wordMatch of pageMatch[1]?.matchAll(wordPattern) ?? []) {
      const text = decodeXmlText(wordMatch[5] ?? "").trim();
      if (!text) continue;
      words.push(text);
      const x = Number(wordMatch[1]);
      const y = Number(wordMatch[2]);
      const xMax = Number(wordMatch[3]);
      const yMax = Number(wordMatch[4]);
      coordinates.push({ text, x, y, width: xMax - x, height: yMax - y });
    }
    pages.push({
      pageNumber: pages.length + 1,
      text: words.join(" "),
      coordinates,
      confidence: method === "native" ? 1 : null,
      language: "it",
      method,
    });
  }
  return pages;
}

function parseTsvPages(
  tsv: string,
): Array<{ pageNumber: number; text: string; confidence: number | null; coordinates: unknown[] }> {
  const lines = tsv.trim().split("\n");
  const pages = new Map<
    number,
    { words: string[]; confidences: number[]; coordinates: unknown[] }
  >();
  for (const line of lines.slice(1)) {
    const columns = line.split("\t");
    if (columns.length < 12) continue;
    const text = columns.slice(11).join("\t").trim();
    const confidence = Number(columns[10]);
    if (!text) continue;
    const pageNumber = Math.max(1, Number(columns[1]) || 1);
    const page = pages.get(pageNumber) ?? { words: [], confidences: [], coordinates: [] };
    pages.set(pageNumber, page);
    page.words.push(text);
    if (Number.isFinite(confidence) && confidence >= 0) page.confidences.push(confidence / 100);
    page.coordinates.push({
      text,
      x: Number(columns[6]),
      y: Number(columns[7]),
      width: Number(columns[8]),
      height: Number(columns[9]),
      confidence: Number.isFinite(confidence) && confidence >= 0 ? confidence / 100 : null,
    });
  }
  return [...pages.entries()]
    .sort(([left], [right]) => left - right)
    .map(([pageNumber, page]) => ({
      pageNumber,
      text: page.words.join(" "),
      confidence:
        page.confidences.length === 0
          ? null
          : page.confidences.reduce((total, value) => total + value, 0) / page.confidences.length,
      coordinates: page.coordinates,
    }));
}

function parseTsv(tsv: string): {
  text: string;
  confidence: number | null;
  coordinates: unknown[];
} {
  const pages = parseTsvPages(tsv);
  const confidences = pages.flatMap((page) => (page.confidence === null ? [] : [page.confidence]));
  return {
    text: pages
      .map((page) => page.text)
      .join(" ")
      .trim(),
    confidence:
      confidences.length === 0
        ? null
        : confidences.reduce((total, value) => total + value, 0) / confidences.length,
    coordinates: pages.flatMap((page) => page.coordinates),
  };
}

async function persistTextArtifact(
  database: Database.Database,
  documentId: string,
  directory: string,
  dataDirectory: string,
  text: string,
  toolName: string,
  toolVersion: string,
): Promise<void> {
  const path = join(directory, `${randomUUID()}.txt`);
  await writeFile(path, text, { encoding: "utf8", mode: 0o600 });
  const artifact = await persistGeneratedArtifact(path, dataDirectory);
  addDocumentArtifact(database, {
    documentId,
    kind: "extracted_text",
    mediaType: "text/plain; charset=utf-8",
    ...artifact,
    toolName,
    toolVersion,
  });
}

async function extractPdf(
  database: Database.Database,
  documentId: string,
  inputPath: string,
  directory: string,
  dataDirectory: string,
  runner: CommandRunner,
): Promise<ProcessResult> {
  const textPath = join(directory, "native.txt");
  const popplerVersion = await readToolVersion("pdftotext", ["-v"], runner);
  await runner("pdftotext", ["-layout", "-enc", "UTF-8", inputPath, textPath], {
    timeoutMs: 120_000,
  });
  let text = await readTextLimited(textPath);
  let method: ExtractedPage["method"] = "native";
  let bboxInput = inputPath;
  let searchablePath: string | null = null;
  if (needsPdfOcr(text)) {
    searchablePath = join(directory, "searchable.pdf");
    await runner(
      "ocrmypdf",
      [
        "--skip-text",
        "--deskew",
        "--rotate-pages",
        "--language",
        "ita",
        "--jobs",
        "1",
        "--output-type",
        "pdf",
        inputPath,
        searchablePath,
      ],
      { timeoutMs: 10 * 60_000, maxOutputBytes: 4 * 1024 * 1024 },
    );
    await runner("pdftotext", ["-layout", "-enc", "UTF-8", searchablePath, textPath], {
      timeoutMs: 120_000,
    });
    text = await readTextLimited(textPath);
    method = "ocr";
    bboxInput = searchablePath;
  }
  const bboxPath = join(directory, "bbox.html");
  await runner("pdftotext", ["-bbox-layout", "-enc", "UTF-8", bboxInput, bboxPath], {
    timeoutMs: 120_000,
  });
  const bboxPages = parsePdfBbox(await readTextLimited(bboxPath), method);
  const pages = bboxPages.length > 0 ? bboxPages : splitTextPages(text, method);
  const previewPrefix = join(directory, "preview");
  await runner(
    "pdftoppm",
    ["-f", "1", "-singlefile", "-png", "-r", "110", bboxInput, previewPrefix],
    { timeoutMs: 120_000, maxOutputBytes: 256 * 1024 },
  );
  const previewArtifact = await persistGeneratedArtifact(`${previewPrefix}.png`, dataDirectory);
  addDocumentArtifact(database, {
    documentId,
    kind: "preview",
    mediaType: "image/png",
    ...previewArtifact,
    pageNumber: 1,
    toolName: "pdftoppm",
    toolVersion: await readToolVersion("pdftoppm", ["-v"], runner),
  });
  if (searchablePath) {
    const artifact = await persistGeneratedArtifact(searchablePath, dataDirectory);
    addDocumentArtifact(database, {
      documentId,
      kind: "searchable_pdf",
      mediaType: "application/pdf",
      ...artifact,
      toolName: "ocrmypdf",
      toolVersion: await readToolVersion("ocrmypdf", ["--version"], runner),
    });
  }
  await persistTextArtifact(
    database,
    documentId,
    directory,
    dataDirectory,
    text,
    "pdftotext",
    popplerVersion,
  );
  return {
    pages,
    detectedFormat: "PDF",
    language: "it",
    status: pages.some((page) => page.text.length > 0) ? "processed" : "unreadable",
  };
}

async function extractImage(
  database: Database.Database,
  documentId: string,
  inputPath: string,
  directory: string,
  dataDirectory: string,
  detection: FormatDetection,
  runner: CommandRunner,
): Promise<ProcessResult> {
  let ocrInput = inputPath;
  if (detection.extension === ".heic" || detection.extension === ".webp") {
    ocrInput = join(directory, "normalized.png");
    await runner("magick", [inputPath, "-auto-orient", "-strip", ocrInput], {
      timeoutMs: 120_000,
    });
    const artifact = await persistGeneratedArtifact(ocrInput, dataDirectory);
    addDocumentArtifact(database, {
      documentId,
      kind: "corrected_image",
      mediaType: "image/png",
      ...artifact,
      toolName: "ImageMagick",
      toolVersion: await readToolVersion("magick", ["-version"], runner),
    });
    ocrInput = resolveBlobPath(dataDirectory, artifact.blobPath);
  }
  const { stdout: tsv } = await runner("tesseract", [ocrInput, "stdout", "-l", "ita", "tsv"], {
    timeoutMs: 5 * 60_000,
    maxOutputBytes: 20 * 1024 * 1024,
  });
  const tesseractVersion = await readToolVersion("tesseract", ["--version"], runner);
  const tsvPath = join(directory, "ocr.tsv");
  await writeFile(tsvPath, tsv, { encoding: "utf8", mode: 0o600 });
  const tsvArtifact = await persistGeneratedArtifact(tsvPath, dataDirectory);
  addDocumentArtifact(database, {
    documentId,
    kind: "ocr_tsv",
    mediaType: "text/tab-separated-values; charset=utf-8",
    ...tsvArtifact,
    toolName: "tesseract",
    toolVersion: tesseractVersion,
  });
  const parsedPages = parseTsvPages(tsv);
  const parsed = parseTsv(tsv);
  await persistTextArtifact(
    database,
    documentId,
    directory,
    dataDirectory,
    parsed.text,
    "tesseract",
    tesseractVersion,
  );
  return {
    pages: parsedPages.map((page) => ({
      ...page,
      language: "it",
      method: "ocr" as const,
    })),
    detectedFormat: detection.format,
    language: "it",
    status:
      parsed.text.length === 0
        ? "unreadable"
        : (parsed.confidence ?? 0) < 0.85
          ? "to_review"
          : "processed",
  };
}

async function inspectArchive(path: string, runner: CommandRunner): Promise<string> {
  const { stdout } = await runner("unzip", ["-Z1", path], {
    timeoutMs: 60_000,
    maxOutputBytes: 4 * 1024 * 1024,
  });
  const names = stdout.split("\n").filter(Boolean);
  if (names.length > 10_000) throw new Error("ARCHIVE_ENTRY_LIMIT");
  for (const name of names) {
    const normalized = name.replaceAll("\\", "/");
    if (normalized.startsWith("/") || normalized.split("/").includes(".."))
      throw new Error("ARCHIVE_PATH_TRAVERSAL");
  }
  const { stdout: totals } = await runner("unzip", ["-Z", "-t", path], {
    timeoutMs: 60_000,
    maxOutputBytes: 64 * 1024,
  });
  const uncompressed = Number(
    totals.match(/([\d,]+) bytes uncompressed/i)?.[1]?.replaceAll(",", ""),
  );
  const compressed = Number(totals.match(/([\d,]+) bytes compressed/i)?.[1]?.replaceAll(",", ""));
  if (Number.isFinite(uncompressed) && uncompressed > 2 * 1024 * 1024 * 1024)
    throw new Error("ARCHIVE_EXPANDED_SIZE_LIMIT");
  if (
    Number.isFinite(uncompressed) &&
    Number.isFinite(compressed) &&
    uncompressed > 100 * 1024 * 1024 &&
    compressed > 0 &&
    uncompressed / compressed > 100
  )
    throw new Error("ARCHIVE_COMPRESSION_RATIO_LIMIT");
  return names.join("\n");
}

async function extractSignedContainer(
  database: Database.Database,
  documentId: string,
  originalName: string,
  inputPath: string,
  directory: string,
  dataDirectory: string,
  runner: CommandRunner,
): Promise<ProcessResult> {
  const extractedPath = join(directory, "signed-content.bin");
  await runner(
    "openssl",
    ["smime", "-verify", "-noverify", "-inform", "DER", "-in", inputPath, "-out", extractedPath],
    { timeoutMs: 120_000, maxOutputBytes: 256 * 1024 },
  );
  const innerName = originalName.slice(0, -4);
  const detection = detectFormat(
    innerName,
    "application/octet-stream",
    await readPrefix(extractedPath),
  );
  const processingPath = join(directory, `signed-processing${detection.extension || ".bin"}`);
  await copyFile(extractedPath, processingPath);
  let result: ProcessResult;
  if (detection.kind === "pdf")
    result = await extractPdf(
      database,
      documentId,
      processingPath,
      directory,
      dataDirectory,
      runner,
    );
  else if (detection.kind === "image")
    result = await extractImage(
      database,
      documentId,
      processingPath,
      directory,
      dataDirectory,
      detection,
      runner,
    );
  else if (detection.kind === "office")
    result = await extractOffice(
      database,
      documentId,
      processingPath,
      directory,
      dataDirectory,
      runner,
    );
  else if (detection.kind === "structured") {
    const text = await readTextLimited(processingPath);
    result = {
      pages: splitTextPages(text, "structured"),
      detectedFormat: `P7M/${detection.format}`,
      language: "it",
      status: text.trim() ? "processed" : "unreadable",
    };
  } else if (detection.kind === "archive") {
    const listing = await inspectArchive(processingPath, runner);
    result = {
      pages: splitTextPages(listing, "structured"),
      detectedFormat: `P7M/${detection.format}`,
      language: null,
      status: "processed",
    };
  } else {
    result = { pages: [], detectedFormat: "P7M", language: null, status: "unsupported" };
  }
  const artifact = await persistGeneratedArtifact(extractedPath, dataDirectory);
  addDocumentArtifact(database, {
    documentId,
    kind: "signed_content",
    mediaType: "application/octet-stream",
    ...artifact,
    toolName: "OpenSSL",
    toolVersion: await readToolVersion("openssl", ["version"], runner),
    metadata: { innerFormat: detection.format },
  });
  return { ...result, detectedFormat: `P7M/${detection.format}` };
}

async function extractOffice(
  database: Database.Database,
  documentId: string,
  inputPath: string,
  directory: string,
  dataDirectory: string,
  runner: CommandRunner,
): Promise<ProcessResult> {
  const outputDirectory = join(directory, "office-output");
  await mkdir(outputDirectory, { mode: 0o700 });
  await runner(
    "soffice",
    [
      "--headless",
      `-env:UserInstallation=file://${join(directory, "libreoffice-profile")}`,
      "--convert-to",
      "pdf",
      "--outdir",
      outputDirectory,
      inputPath,
    ],
    { timeoutMs: 5 * 60_000, maxOutputBytes: 2 * 1024 * 1024 },
  );
  const pdfPath = join(outputDirectory, `${basename(inputPath, extname(inputPath))}.pdf`);
  const processingPath = join(directory, "office-processing.pdf");
  await copyFile(pdfPath, processingPath);
  const artifact = await persistGeneratedArtifact(pdfPath, dataDirectory);
  addDocumentArtifact(database, {
    documentId,
    kind: "office_pdf",
    mediaType: "application/pdf",
    ...artifact,
    toolName: "LibreOffice",
    toolVersion: await readToolVersion("soffice", ["--version"], runner),
  });
  const result = await extractPdf(
    database,
    documentId,
    processingPath,
    directory,
    dataDirectory,
    runner,
  );
  return { ...result, detectedFormat: "OFFICE" };
}

export async function processDocument(
  database: Database.Database,
  documentId: string,
  options: {
    dataDirectory?: string;
    runner?: CommandRunner;
    signal?: AbortSignal;
    onProgress?: (progress: number) => void;
  } = {},
): Promise<void> {
  const dataDirectory = options.dataDirectory ?? getDataDirectory();
  const baseRunner = options.runner ?? runCommand;
  const runner: CommandRunner = (command, arguments_, runnerOptions = {}) =>
    baseRunner(command, arguments_, { ...runnerOptions, signal: options.signal });
  if (options.signal?.aborted) throw new Error("TOOL_CANCELLED");
  const document = getDocument(database, documentId);
  if (!document) throw new Error("DOCUMENT_NOT_FOUND");
  const previousStatus = document.status;
  options.onProgress?.(5);
  updateDocumentProcessing(database, documentId, { status: "classifying", processingError: null });
  const originalPath = resolveBlobPath(dataDirectory, document.blobPath);
  const detection = detectFormat(
    document.originalName,
    document.mediaType,
    await readPrefix(originalPath),
  );
  options.onProgress?.(12);
  if (!SUPPORTED_EXTENSIONS.has(detection.extension)) {
    updateDocumentProcessing(database, documentId, {
      status: "unsupported",
      detectedFormat: detection.format,
      processingError: null,
    });
    return;
  }

  const jobsDirectory = join(dataDirectory, "tmp", "jobs");
  await mkdir(jobsDirectory, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(jobsDirectory, "document-"));
  const inputPath = join(directory, `input${detection.extension || ".bin"}`);
  try {
    await copyFile(originalPath, inputPath);
    if (options.signal?.aborted) throw new Error("TOOL_CANCELLED");
    updateDocumentProcessing(database, documentId, {
      status: "processing",
      detectedFormat: detection.format,
      processingError: null,
    });
    options.onProgress?.(20);
    let result: ProcessResult;
    if (detection.kind === "pdf") {
      result = await extractPdf(database, documentId, inputPath, directory, dataDirectory, runner);
    } else if (detection.kind === "image") {
      result = await extractImage(
        database,
        documentId,
        inputPath,
        directory,
        dataDirectory,
        detection,
        runner,
      );
    } else if (detection.kind === "office") {
      result = await extractOffice(
        database,
        documentId,
        inputPath,
        directory,
        dataDirectory,
        runner,
      );
    } else if (detection.kind === "structured") {
      const text = await readTextLimited(inputPath);
      result = {
        pages: splitTextPages(text, "structured"),
        detectedFormat: detection.format,
        language: "it",
        status: text.trim() ? "processed" : "unreadable",
      };
      await persistTextArtifact(
        database,
        documentId,
        directory,
        dataDirectory,
        text,
        "native",
        "1",
      );
    } else if (detection.kind === "archive") {
      const listing = await inspectArchive(inputPath, runner);
      await persistTextArtifact(
        database,
        documentId,
        directory,
        dataDirectory,
        listing,
        "unzip",
        await readToolVersion("unzip", ["-v"], runner),
      );
      result = {
        pages: [
          {
            pageNumber: 1,
            text: listing,
            confidence: 1,
            language: null,
            method: "structured",
          },
        ],
        detectedFormat: detection.format,
        language: null,
        status: "processed",
      };
    } else if (detection.kind === "signed") {
      result = await extractSignedContainer(
        database,
        documentId,
        document.originalName,
        inputPath,
        directory,
        dataDirectory,
        runner,
      );
    } else {
      result = {
        pages: [],
        detectedFormat: detection.format,
        language: null,
        status: "unsupported",
      };
    }
    options.onProgress?.(85);
    replaceDocumentPages(database, documentId, result.pages);
    updateDocumentProcessing(database, documentId, {
      status: result.status,
      detectedFormat: result.detectedFormat,
      pageCount: result.pages.length,
      language: result.language,
      processingError: null,
    });
    options.onProgress?.(95);
    const lowConfidence = result.pages.find(
      (page) => page.method === "ocr" && (page.confidence ?? 0) < 0.85,
    );
    if (lowConfidence) {
      createReviewItem(database, {
        practiceId: document.practiceId,
        documentId,
        pageNumber: lowConfidence.pageNumber,
        subjectKey: `document.${documentId}.readability`,
        label: "Qualità della lettura OCR",
        proposedValue: "Controllare il testo estratto",
        method: "ocr",
        confidence: lowConfidence.confidence,
        sourceExcerpt: lowConfidence.text.slice(0, 320),
        sourceRefs: [
          {
            documentId,
            pageNumber: lowConfidence.pageNumber,
            value: "Controllare il testo estratto",
          },
        ],
        ruleVersion: "m3-ocr-confidence-v1",
      });
    }
  } catch (error) {
    const code =
      error instanceof Error ? error.message.slice(0, 240) : "DOCUMENT_PROCESSING_FAILED";
    if (code === "TOOL_CANCELLED") {
      updateDocumentProcessing(database, documentId, {
        status: ["classifying", "processing"].includes(previousStatus)
          ? "received"
          : previousStatus,
        processingError: null,
      });
      throw error;
    }
    updateDocumentProcessing(database, documentId, {
      status: code.startsWith("ARCHIVE_") ? "unsupported" : "unreadable",
      detectedFormat: detection.format,
      processingError: code,
    });
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export const documentProcessingInternals = {
  detectFormat,
  parseTsv,
  parseTsvPages,
  parsePdfBbox,
  inspectArchive,
  splitTextPages,
  decodeXmlText,
  needsPdfOcr,
};
