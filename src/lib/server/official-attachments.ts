import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { tmpdir } from "node:os";
import { persistGeneratedArtifact, resolveBlobPath } from "./blob-store.ts";
import { getDataDirectory } from "./config.ts";
import { getDocument, updateDocumentProcessing } from "./documents.ts";
import { runCommand, type CommandRunner } from "./process-tools.ts";

const MAX_OFFICIAL_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_OFFICIAL_PACKAGE_BYTES = 40 * 1024 * 1024;

export interface OfficialAttachment {
  id: string;
  documentId: string;
  practiceId: string;
  originalName: string;
  preparedName: string;
  format: "PDF/A-1b" | "TIFF-G4";
  byteSize: number;
  sha256: string;
  blobPath: string;
  validation: Record<string, unknown>;
  sourceRefs: string[];
  createdAt: string;
}

interface PreparedFile {
  path: string;
  name: string;
  format: OfficialAttachment["format"];
  validation: Record<string, unknown>;
}

const PDFA_PREFIX = `%!
[/_objdef {icc_PDFA} /type /stream /OBJ pdfmark
[{icc_PDFA} << /N 3 >> /PUT pdfmark
[{icc_PDFA} ICCProfile (r) file /PUT pdfmark
[/_objdef {OutputIntent_PDFA} /type /dict /OBJ pdfmark
[{OutputIntent_PDFA} << /Type /OutputIntent /S /GTS_PDFA1
  /DestOutputProfile {icc_PDFA} /OutputConditionIdentifier (sRGB) >> /PUT pdfmark
[{Catalog} << /OutputIntents [ {OutputIntent_PDFA} ] >> /PUT pdfmark
`;

function mapAttachment(row: Record<string, unknown>): OfficialAttachment {
  return {
    id: String(row.id),
    documentId: String(row.document_id),
    practiceId: String(row.practice_id),
    originalName: String(row.original_name),
    preparedName: String(row.prepared_name),
    format: String(row.format) as OfficialAttachment["format"],
    byteSize: Number(row.byte_size),
    sha256: String(row.sha256),
    blobPath: String(row.blob_path),
    validation: JSON.parse(String(row.validation_json)) as Record<string, unknown>,
    sourceRefs: JSON.parse(String(row.source_refs_json)) as string[],
    createdAt: String(row.created_at),
  };
}

export function listOfficialAttachments(
  database: Database.Database,
  practiceId: string,
): OfficialAttachment[] {
  return (
    database
      .prepare(
        `SELECT * FROM official_attachments
         WHERE practice_id = ? ORDER BY document_id, prepared_name`,
      )
      .all(practiceId) as Array<Record<string, unknown>>
  ).map(mapAttachment);
}

function locateSrgbProfile(): string {
  const candidates = [
    "/usr/share/ghostscript/iccprofiles/srgb.icc",
    "/usr/share/color/icc/ghostscript/srgb.icc",
    "/opt/homebrew/share/ghostscript/iccprofiles/srgb.icc",
  ];
  const profile = candidates.find(existsSync);
  if (!profile) throw new Error("PROFILO_COLORE_NON_DISPONIBILE");
  return profile;
}

async function pdfPageCount(path: string, runner: CommandRunner): Promise<number> {
  const { stdout } = await runner("pdfinfo", [path], { timeoutMs: 30_000 });
  const count = Number(/^Pages:\s+(\d+)$/mu.exec(stdout)?.[1]);
  if (!Number.isInteger(count) || count < 1) throw new Error("PDF_NON_LEGGIBILE");
  return count;
}

async function validatePdfA(path: string, runner: CommandRunner): Promise<Record<string, unknown>> {
  await runner("qpdf", ["--check", path], { timeoutMs: 60_000 });
  const bytes = await readFile(path);
  const text = bytes.toString("latin1");
  if (
    !text.includes("pdfaid:part='1'") ||
    !text.includes("pdfaid:conformance='B'") ||
    !text.includes("/GTS_PDFA1") ||
    !text.includes("/OutputIntent")
  )
    throw new Error("VALIDAZIONE_PDFA_NON_SUPERATA");
  const metadata = await stat(path);
  if (metadata.size > MAX_OFFICIAL_ATTACHMENT_BYTES) throw new Error("ALLEGATO_OLTRE_5_MB");
  return {
    profile: "PDF/A-1b",
    structuralCheck: "qpdf",
    outputIntent: "sRGB",
    bytes: metadata.size,
    sourceRefs: ["SRC-07", "SRC-08", "SRC-09"],
  };
}

async function convertPdfRange(
  inputPath: string,
  outputPath: string,
  prefixPath: string,
  iccProfile: string,
  runner: CommandRunner,
  pageRange?: string,
): Promise<void> {
  const sourcePath = pageRange ? `${outputPath}.source.pdf` : inputPath;
  if (pageRange)
    await runner("qpdf", [inputPath, "--pages", ".", pageRange, "--", sourcePath], {
      timeoutMs: 60_000,
    });
  await runner(
    "gs",
    [
      "-q",
      "-dBATCH",
      "-dNOPAUSE",
      "-dSAFER",
      `--permit-file-read=${iccProfile}`,
      "-dPDFA=1",
      "-dPDFACompatibilityPolicy=1",
      "-sDEVICE=pdfwrite",
      "-sColorConversionStrategy=RGB",
      "-dEmbedAllFonts=true",
      "-dSubsetFonts=true",
      `-sOutputFile=${outputPath}`,
      prefixPath,
      sourcePath,
    ],
    { timeoutMs: 5 * 60_000, maxOutputBytes: 2 * 1024 * 1024 },
  );
}

async function preparePdf(
  inputPath: string,
  originalName: string,
  directory: string,
  runner: CommandRunner,
): Promise<PreparedFile[]> {
  const profile = locateSrgbProfile();
  const prefixPath = join(directory, "pdfa-prefix.ps");
  await writeFile(prefixPath, `/ICCProfile (${profile}) def\n${PDFA_PREFIX}`, {
    encoding: "utf8",
    mode: 0o600,
  });
  const stem = basename(originalName, extname(originalName)).replaceAll(/[^A-Za-z0-9._-]+/gu, "-");
  const fullPath = join(directory, `${stem || "allegato"}.pdf`);
  await convertPdfRange(inputPath, fullPath, prefixPath, profile, runner);
  if ((await stat(fullPath)).size <= MAX_OFFICIAL_ATTACHMENT_BYTES)
    return [
      {
        path: fullPath,
        name: `${stem || "allegato"}.pdf`,
        format: "PDF/A-1b",
        validation: await validatePdfA(fullPath, runner),
      },
    ];

  const pages = await pdfPageCount(inputPath, runner);
  const prepared: PreparedFile[] = [];
  let start = 1;
  while (start <= pages) {
    let end = pages;
    let accepted: PreparedFile | null = null;
    while (end >= start) {
      const suffix = String(prepared.length + 1).padStart(2, "0");
      const path = join(directory, `${stem || "allegato"}-${suffix}.pdf`);
      await convertPdfRange(inputPath, path, prefixPath, profile, runner, `${start}-${end}`);
      if ((await stat(path)).size <= MAX_OFFICIAL_ATTACHMENT_BYTES) {
        accepted = {
          path,
          name: `${stem || "allegato"}-${suffix}.pdf`,
          format: "PDF/A-1b",
          validation: await validatePdfA(path, runner),
        };
        break;
      }
      if (end === start) throw new Error("PAGINA_PDF_OLTRE_5_MB");
      end = start + Math.floor((end - start) / 2);
    }
    if (!accepted) throw new Error("SUDDIVISIONE_PDF_NON_RIUSCITA");
    prepared.push(accepted);
    start = end + 1;
  }
  return prepared;
}

async function validateTiff(path: string, runner: CommandRunner): Promise<Record<string, unknown>> {
  const { stdout } = await runner("identify", ["-format", "%m|%z|%x|%y|%U|%C", `${path}[0]`], {
    timeoutMs: 60_000,
  });
  const [format, depth, xResolution, yResolution, units, compression] = stdout.split("|");
  if (
    format !== "TIFF" ||
    Number(depth) > 1 ||
    Number(xResolution) > 300 ||
    Number(yResolution) > 300 ||
    units !== "PixelsPerInch" ||
    !/Group4/i.test(compression ?? "")
  )
    throw new Error("VALIDAZIONE_TIFF_NON_SUPERATA");
  const metadata = await stat(path);
  if (metadata.size > MAX_OFFICIAL_ATTACHMENT_BYTES) throw new Error("ALLEGATO_OLTRE_5_MB");
  return {
    profile: "TIFF-G4",
    bitDepth: Number(depth),
    resolution: [Number(xResolution), Number(yResolution)],
    compression,
    bytes: metadata.size,
    sourceRefs: ["SRC-07", "SRC-08", "SRC-09"],
  };
}

async function prepareImage(
  inputPath: string,
  originalName: string,
  directory: string,
  runner: CommandRunner,
): Promise<PreparedFile[]> {
  const stem = basename(originalName, extname(originalName)).replaceAll(/[^A-Za-z0-9._-]+/gu, "-");
  const pattern = join(directory, `${stem || "allegato"}-%03d.tiff`);
  const args = [
    inputPath,
    "-alpha",
    "off",
    "-colorspace",
    "Gray",
    "-threshold",
    "50%",
    "-units",
    "PixelsPerInch",
    "-density",
    "300",
    "-depth",
    "1",
    "-compress",
    "Group4",
    "+adjoin",
    pattern,
  ];
  const options = { timeoutMs: 5 * 60_000, maxOutputBytes: 2 * 1024 * 1024 };
  try {
    await runner("magick", args, options);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("TOOL_UNAVAILABLE:magick:"))
      throw error;
    await runner("convert", args, options);
  }
  const files: PreparedFile[] = [];
  for (let index = 0; ; index += 1) {
    const path = pattern.replace("%03d", String(index).padStart(3, "0"));
    if (!existsSync(path)) break;
    files.push({
      path,
      name: basename(path),
      format: "TIFF-G4",
      validation: await validateTiff(path, runner),
    });
  }
  if (files.length === 0) throw new Error("CONVERSIONE_TIFF_NON_RIUSCITA");
  return files;
}

function preparedSource(
  database: Database.Database,
  document: NonNullable<ReturnType<typeof getDocument>>,
): { blobPath: string; mediaType: string } {
  if (document.mediaType === "application/pdf" || document.mediaType.startsWith("image/"))
    return { blobPath: document.blobPath, mediaType: document.mediaType };
  const artifact = database
    .prepare(
      `SELECT blob_path, media_type FROM document_artifacts
       WHERE document_id = ? AND media_type IN ('application/pdf', 'image/tiff')
       ORDER BY CASE kind WHEN 'office_pdf' THEN 0 WHEN 'signed_content' THEN 1 ELSE 2 END,
                created_at DESC LIMIT 1`,
    )
    .get(document.id) as { blob_path: string; media_type: string } | undefined;
  if (!artifact) throw new Error("FORMATO_ALLEGATO_NON_PREPARABILE");
  return { blobPath: artifact.blob_path, mediaType: artifact.media_type };
}

export async function prepareOfficialAttachment(
  database: Database.Database,
  input: { practiceId: string; documentId: string; dataDirectory?: string },
  runner: CommandRunner = runCommand,
): Promise<OfficialAttachment[]> {
  const document = getDocument(database, input.documentId, input.practiceId);
  if (!document) throw new Error("DOCUMENTO_NON_TROVATO");
  const dataDirectory = input.dataDirectory ?? getDataDirectory();
  const source = preparedSource(database, document);
  const sourcePath = resolveBlobPath(dataDirectory, source.blobPath);
  const directory = await mkdtemp(join(tmpdir(), "sequent-allegato-"));
  try {
    const prepared =
      source.mediaType === "application/pdf"
        ? await preparePdf(sourcePath, document.originalName, directory, runner)
        : await prepareImage(sourcePath, document.originalName, directory, runner);
    const total = prepared.reduce(
      (sum, file) => sum + Number((file.validation.bytes as number | undefined) ?? 0),
      0,
    );
    const existingTotal = (
      database
        .prepare(
          `SELECT coalesce(sum(byte_size), 0) AS total FROM official_attachments
           WHERE practice_id = ? AND document_id <> ?`,
        )
        .get(input.practiceId, document.id) as { total: number }
    ).total;
    if (existingTotal + total > MAX_OFFICIAL_PACKAGE_BYTES)
      throw new Error("PACCHETTO_ALLEGATI_OLTRE_40_MB");
    const now = new Date().toISOString();
    const persisted = [] as Array<{
      file: PreparedFile;
      artifact: Awaited<ReturnType<typeof persistGeneratedArtifact>>;
    }>;
    for (const file of prepared)
      persisted.push({ file, artifact: await persistGeneratedArtifact(file.path, dataDirectory) });
    database.transaction(() => {
      database.prepare("DELETE FROM official_attachments WHERE document_id = ?").run(document.id);
      const insert = database.prepare(
        `INSERT INTO official_attachments(
           id, document_id, practice_id, original_name, prepared_name, format, byte_size,
           sha256, blob_path, validation_json, source_refs_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const { file, artifact } of persisted)
        insert.run(
          randomUUID(),
          document.id,
          input.practiceId,
          document.originalName,
          file.name,
          file.format,
          artifact.byteSize,
          artifact.sha256,
          artifact.blobPath,
          JSON.stringify(file.validation),
          JSON.stringify(["SRC-07", "SRC-08", "SRC-09"]),
          now,
        );
      updateDocumentProcessing(database, document.id, { status: "included_attachment" });
    })();
    return listOfficialAttachments(database, input.practiceId).filter(
      (attachment) => attachment.documentId === document.id,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
