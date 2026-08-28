import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const catalogDirectory = resolve(repositoryRoot, "src/domain/official-catalog");
const sourceManifestPath = resolve(catalogDirectory, "source-manifest.json");
const qualificationPath = resolve(catalogDirectory, "suc13-control-qualification.json");
const fixturePath = resolve(repositoryRoot, "tests/fixtures/official/suc13-control.synthetic.xml");

const sha256 = (filePath) => createHash("sha256").update(readFileSync(filePath)).digest("hex");

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
  if (result.error || result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new Error(`${command} non è terminato correttamente${detail ? `:\n${detail}` : "."}`, {
      cause: result.error,
    });
  }
  return result;
};

const sourceById = (manifest, sourceId) => {
  const source = manifest.sources.find((candidate) => candidate.id === sourceId);
  if (!source) throw new Error(`Fonte ${sourceId} non presente nel manifest.`);
  return source;
};

const resolveSource = (source) => resolve(repositoryRoot, "private/official-sources", source.alias);

const verifySource = (source) => {
  const filePath = resolveSource(source);
  if (!existsSync(filePath)) throw new Error(`Originale ufficiale assente: ${source.alias}`);
  const actualHash = sha256(filePath);
  if (actualHash !== source.sha256) {
    throw new Error(`Hash non conforme per ${source.id}: ${source.alias}`);
  }
  return filePath;
};

const extractSignedControlLibraries = (pluginPath, targetDirectory) => {
  run("unzip", ["-q", pluginPath, "lib/*", "-d", targetDirectory]);
  const libraryDirectory = join(targetDirectory, "lib");
  for (const fileName of readdirSync(libraryDirectory).filter((name) => name.endsWith(".jar"))) {
    const jarPath = join(libraryDirectory, fileName);
    const entries = run("unzip", ["-Z1", jarPath])
      .stdout.split(/\r?\n/u)
      .filter((entry) => /^META-INF\/.*\.(?:SF|RSA|DSA)$/iu.test(entry));
    if (entries.length > 0) run("zip", ["-q", "-d", jarPath, ...entries]);
  }
  return libraryDirectory;
};

const extractDesktopJava = (desktopArchivePath, targetDirectory) => {
  run("unzip", [
    "-q",
    desktopArchivePath,
    "DesktopTelematico.app/jre/Contents/Home/jre/*",
    "-d",
    targetDirectory,
  ]);
  const javaPath = join(targetDirectory, "DesktopTelematico.app/jre/Contents/Home/jre/bin/java");
  if (!existsSync(javaPath) || !statSync(javaPath).isFile()) {
    throw new Error("Runtime Java ufficiale non trovato nell'archivio Desktop Telematico.");
  }
  chmodSync(javaPath, 0o755);
  return javaPath;
};

export const parseDgn = (content) => {
  const lines = content.split(/\r?\n/u).filter(Boolean);
  const header = lines.find((line) => line.startsWith("0USUC13"));
  const release = header?.match(/\s(\d+\.\d+\.\d+)\s+(\d{2}\/\d{2}\/\d{4})/u);
  const diagnostics = lines
    .filter((line) => line.startsWith("1") && !line.startsWith("1VALIDAZIONE"))
    .map((line) => ({
      severity: line.slice(17, 19),
      code: line.slice(19, 23),
      field: line.slice(23, 28).trim() || null,
      declarationId: line.slice(-5),
    }));
  return {
    version: release?.[1] ?? null,
    releaseDate: release?.[2] ?? null,
    diagnostics,
    blockingDiagnostics: diagnostics.filter((diagnostic) => diagnostic.severity === "16"),
    advisoryDiagnostics: diagnostics.filter((diagnostic) => diagnostic.severity === "04"),
  };
};

const buildQualification = () => {
  const manifest = JSON.parse(readFileSync(sourceManifestPath, "utf8"));
  const desktopSource = sourceById(manifest, "SRC-33");
  const controlSource = sourceById(manifest, "SRC-39");
  const desktopArchivePath = verifySource(desktopSource);
  const pluginPath = verifySource(controlSource);
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "sequent-suc13-qualification-"));

  try {
    const javaPath = extractDesktopJava(desktopArchivePath, temporaryDirectory);
    const controlDirectory = join(temporaryDirectory, "control");
    const libraryDirectory = extractSignedControlLibraries(pluginPath, controlDirectory);
    const stableFixturePath = join(temporaryDirectory, basename(fixturePath));
    copyFileSync(fixturePath, stableFixturePath);
    const resultBase = join(temporaryDirectory, "result.xml");
    const control = run(javaPath, [
      "-cp",
      `${libraryDirectory}/*`,
      "it.finanze.entrate.sco.main.MSUC13",
      stableFixturePath,
      resultBase,
    ]);
    const schemaPath = join(temporaryDirectory, "result_logSchema.xml");
    const diagnosticPath = join(temporaryDirectory, "result.dgn");
    const schemaResult = readFileSync(schemaPath, "utf8");
    const parsed = parseDgn(readFileSync(diagnosticPath, "utf8"));
    const schemaValid =
      /<sc:WellFormed>true<\/sc:WellFormed>/u.test(schemaResult) &&
      /<sc:Valid>true<\/sc:Valid>/u.test(schemaResult) &&
      /<sc:Completo>true<\/sc:Completo>/u.test(schemaResult);
    if (!schemaValid || parsed.blockingDiagnostics.length > 0) {
      throw new Error(
        `La pratica sintetica non supera il controllo ufficiale: schema=${schemaValid}, errori bloccanti=${parsed.blockingDiagnostics.length}.`,
      );
    }

    return {
      schemaVersion: 1,
      bundleId: manifest.bundleId,
      status: "qualified",
      control: {
        name: "SUC13",
        version: parsed.version,
        releaseDate: parsed.releaseDate,
        sourceId: controlSource.id,
        sourceSha256: controlSource.sha256,
      },
      runtime: {
        name: "Desktop Telematico per macOS",
        sourceId: desktopSource.id,
        sourceSha256: desktopSource.sha256,
      },
      fixture: {
        path: "tests/fixtures/official/suc13-control.synthetic.xml",
        sha256: sha256(fixturePath),
        synthetic: true,
        successionOpenedOn: "2024-01-01",
        includes: [
          "presentatore con carica 5",
          "soggetto del Quadro EA",
          "titolo esente devoluto",
          "allegati TIFF Group 4",
        ],
      },
      result: {
        wellFormed: true,
        schemaValid: true,
        blockingDiagnostics: parsed.blockingDiagnostics,
        advisoryDiagnostics: parsed.advisoryDiagnostics,
        accepted: true,
      },
      headlessExecution: {
        signatureHandling:
          "Le sole firme dei JAR annidati vengono rimosse da copie temporanee per riprodurre fuori da Eclipse il classloader a bundle; gli originali versionati non vengono modificati e sono verificati per hash.",
        outputEvidence: control.stdout.includes("numero errori 0")
          ? "official-summary-zero-errors"
          : "diagnostic-record-zero-blocking-errors",
      },
      scope: {
        proven:
          "Il pacchetto ufficiale corrente e il runtime ufficiale eseguono il controllo completo della pratica sintetica pre-2025 senza errori bloccanti.",
        temporalBoundary:
          "I campi di autoliquidazione introdotti dal 2025 sono qualificati separatamente mediante XSD corrente, regole temporali e casi di calcolo; non sono dedotti da questa pratica pre-2025.",
      },
    };
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
};

const main = () => {
  const qualification = buildQualification();
  const serialized = `${JSON.stringify(qualification, null, 2)}\n`;
  if (process.argv.includes("--write")) {
    writeFileSync(qualificationPath, serialized);
    console.log(`Qualificazione SUC13 aggiornata: ${qualificationPath}`);
  } else {
    if (!existsSync(qualificationPath) || readFileSync(qualificationPath, "utf8") !== serialized) {
      throw new Error(
        "La qualificazione SUC13 versionata non coincide con l'esecuzione corrente. Eseguire con --write dopo avere verificato le fonti.",
      );
    }
    console.log(
      `SUC13 ${qualification.control.version}: pratica sintetica accettata, ${qualification.result.advisoryDiagnostics.length} avviso non bloccante.`,
    );
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
