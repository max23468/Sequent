#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Source = {
  id: string;
  alias: string;
  pages: number | null;
  bytes: number;
  sha256: string;
  officialSha256?: string;
};

type SourceManifest = {
  bundleId: string;
  compositeSha256: string;
  xsdTreeCompositeSha256: string;
  sources: Source[];
};

type XsdEntry = { path: string; bytes: number; sha256: string };
type XsdManifest = { mainSchema: string; fileCount: number; entries: XsdEntry[] };
type CanonicalSourceManifest = SourceManifest & { xsdArchive: XsdManifest };

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "../..");

function fail(message: string): never {
  throw new Error(message);
}

export function assertSafeRelativePath(relativePath: string): void {
  const normalized = relativePath.replaceAll("\\", "/");
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    normalized.split("/").includes("..")
  ) {
    fail(`path non sicuro: ${relativePath}`);
  }
}

export function sha256File(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function compositeDigest(lines: string[]): string {
  return createHash("sha256").update(lines.join(""), "utf8").digest("hex");
}

export function assertCanonicalManifestParity(
  privateManifest: CanonicalSourceManifest,
  privateXsdManifest: XsdManifest,
  canonicalManifest: CanonicalSourceManifest,
): void {
  if (!isDeepStrictEqual(privateManifest, canonicalManifest)) {
    fail("manifest privato diverso dal manifest canonico versionato");
  }
  if (!isDeepStrictEqual(privateXsdManifest, canonicalManifest.xsdArchive)) {
    fail("manifest XSD privato diverso dall'inventario XSD canonico versionato");
  }
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function run(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function commandSucceeds(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function compileXsdWithAvailablePython(script: string, schema: string): void {
  const python = process.env.SEQUENT_PYTHON ?? "python3";
  if (commandSucceeds(python, ["-c", "import lxml"])) {
    run(python, [script, schema]);
    return;
  }
  if (!commandSucceeds("uv", ["--version"])) {
    fail(
      "lxml non disponibile: installare python3-lxml oppure uv, o indicare un Python idoneo in SEQUENT_PYTHON",
    );
  }
  const requirements = readFileSync(path.join(repoRoot, "requirements-ocr.txt"), "utf8");
  const lxmlVersion = /^lxml==([^\s]+)$/mu.exec(requirements)?.[1];
  if (!lxmlVersion) fail("versione lxml non dichiarata in requirements-ocr.txt");
  run("uv", ["run", "--no-project", "--with", `lxml==${lxmlVersion}`, "python", script, schema]);
}

function verifyPdfPages(filePath: string, expectedPages: number): void {
  const output = run("pdfinfo", [filePath]);
  const match = /^Pages:\s+(\d+)$/mu.exec(output);
  if (!match || Number(match[1]) !== expectedPages) {
    fail(`numero pagine errato per ${path.basename(filePath)}: ${match?.[1] ?? "ignoto"}`);
  }
}

function verifyHtmlSnapshot(filePath: string): void {
  const content = readFileSync(filePath, "utf8");
  if (!/<html\b/iu.test(content)) {
    fail(`snapshot HTML non valido: ${path.basename(filePath)}`);
  }
  if (/Errore nel caricamento delle informazioni/iu.test(content)) {
    fail(`snapshot HTML contiene una pagina di errore: ${path.basename(filePath)}`);
  }
}

function verifyArchive(filePath: string): void {
  run("unzip", ["-tqq", filePath]);
}

function listFiles(root: string, relativeRoot = ""): string[] {
  const directory = path.join(root, relativeRoot);
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.posix.join(relativeRoot, entry.name);
    return entry.isDirectory() ? listFiles(root, relativePath) : [relativePath];
  });
}

function verifyFile(
  root: string,
  relativePath: string,
  expectedBytes: number,
  expectedHash: string,
) {
  assertSafeRelativePath(relativePath);
  const filePath = path.join(root, relativePath);
  const actualBytes = statSync(filePath).size;
  if (actualBytes !== expectedBytes) {
    fail(`dimensione errata per ${relativePath}: ${actualBytes} != ${expectedBytes}`);
  }
  const actualHash = sha256File(filePath);
  if (actualHash !== expectedHash) {
    fail(`hash errato per ${relativePath}: ${actualHash} != ${expectedHash}`);
  }
  return { filePath, actualHash };
}

export function verifyOfficialSources(officialRoot: string): void {
  const manifestPath = path.join(officialRoot, "manifest.json");
  const xsdManifestPath = path.join(officialRoot, "xsd-manifest.json");
  const privateManifest = readJson<CanonicalSourceManifest>(manifestPath);
  const xsdManifest = readJson<XsdManifest>(xsdManifestPath);
  const manifest = readJson<CanonicalSourceManifest>(
    path.join(repoRoot, "src/domain/official-catalog/source-manifest.json"),
  );

  assertCanonicalManifestParity(privateManifest, xsdManifest, manifest);

  if (manifest.sources.length === 0) fail("manifest privo di fonti");
  const sourceIds = new Set(manifest.sources.map((source) => source.id));
  const sourceAliases = new Set(manifest.sources.map((source) => source.alias));
  if (sourceIds.size !== manifest.sources.length) fail("identificativi fonte duplicati");
  if (sourceAliases.size !== manifest.sources.length) fail("alias fonte duplicati");
  if (xsdManifest.entries.length !== xsdManifest.fileCount || xsdManifest.fileCount !== 13) {
    fail(`XSD attesi 13, trovati ${xsdManifest.entries.length}`);
  }

  const expectedFiles = new Set([
    "manifest.json",
    "xsd-manifest.json",
    ...manifest.sources.map((source) => source.alias),
    ...xsdManifest.entries.map((entry) => path.posix.join("xsd", entry.path)),
  ]);
  const actualFiles = listFiles(officialRoot);
  const undeclaredFiles = actualFiles.filter((file) => !expectedFiles.has(file));
  const missingFiles = [...expectedFiles].filter((file) => !actualFiles.includes(file));
  if (undeclaredFiles.length > 0) {
    fail(`file non dichiarati nel pacchetto ufficiale: ${undeclaredFiles.join(", ")}`);
  }
  if (missingFiles.length > 0) {
    fail(`file dichiarati ma mancanti nel pacchetto ufficiale: ${missingFiles.join(", ")}`);
  }

  const sourceLines = [...manifest.sources]
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    .map((source) => {
      const result = verifyFile(officialRoot, source.alias, source.bytes, source.sha256);
      if (source.officialSha256 && result.actualHash !== source.officialSha256) {
        fail(`hash diverso dall'impronta ufficiale per ${source.alias}`);
      }
      if (source.pages !== null) verifyPdfPages(result.filePath, source.pages);
      if (source.alias.endsWith(".html")) verifyHtmlSnapshot(result.filePath);
      if (source.alias.endsWith(".zip") || source.alias.endsWith(".jar")) {
        verifyArchive(result.filePath);
      }
      return `${source.id}:${result.actualHash}\n`;
    });
  const sourceComposite = compositeDigest(sourceLines);
  if (sourceComposite !== manifest.compositeSha256) {
    fail(`digest composito fonti errato: ${sourceComposite}`);
  }

  const xsdRoot = path.join(officialRoot, "xsd");
  const xsdLines = [...xsdManifest.entries]
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
    .map((entry) => {
      const result = verifyFile(xsdRoot, entry.path, entry.bytes, entry.sha256);
      run("xmllint", ["--noout", "--nonet", result.filePath]);
      return `${entry.path}:${result.actualHash}\n`;
    });
  const xsdComposite = compositeDigest(xsdLines);
  if (xsdComposite !== manifest.xsdTreeCompositeSha256) {
    fail(`digest composito XSD errato: ${xsdComposite}`);
  }

  const archive = manifest.sources.find((source) => source.id === "SRC-08");
  if (!archive) fail("SRC-08 mancante");
  run("python3", [
    path.join(repoRoot, "scripts/official-sources/check-archive.py"),
    path.join(officialRoot, archive.alias),
    xsdManifestPath,
  ]);
  compileXsdWithAvailablePython(
    path.join(repoRoot, "scripts/official-sources/compile-xsd.py"),
    path.join(xsdRoot, xsdManifest.mainSchema),
  );

  console.log(`OK: ${manifest.bundleId}`);
  console.log(`  fonti: ${manifest.sources.length}`);
  console.log(`  XSD: ${xsdManifest.entries.length}`);
  console.log(`  bundle: ${sourceComposite}`);
  console.log(`  albero XSD: ${xsdComposite}`);
  console.log(`  main schema: ${xsdManifest.mainSchema}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const officialRoot = path.resolve(
    process.env.SEQUENT_OFFICIAL_SOURCES_DIR ?? path.join(repoRoot, "private/official-sources"),
  );
  verifyOfficialSources(officialRoot);
}
