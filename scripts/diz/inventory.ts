#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseDiz } from "../../src/domain/diz/index.ts";

type Options = {
  authorizationDate: string;
  corpus: string;
  output?: string;
  roundTripQualification?: {
    observedOn: string;
    platform: string;
    sampleIds: readonly string[];
    software: string;
    softwareVersion: string;
  };
};

function assertIsoDate(value: string | undefined, label: string): string {
  const timestamp = value ? Date.parse(`${value}T00:00:00.000Z`) : Number.NaN;
  if (
    !value ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`${label} deve essere una data valida nel formato AAAA-MM-GG`);
  }
  return value;
}

function parseOptions(argv: readonly string[]): Options {
  const [corpus, ...rest] = argv;
  if (!corpus) {
    throw new Error(
      "uso: npm run diz:inventory -- CORPUS --authorized-on AAAA-MM-GG [--output FILE_PRIVATO] " +
        "[--round-trip-samples sample-01,sample-02 --qualification-on AAAA-MM-GG " +
        "--qualification-platform PIATTAFORMA --qualification-software SOFTWARE " +
        "--qualification-version VERSIONE]",
    );
  }
  let authorizationDate: string | undefined;
  let output: string | undefined;
  let qualificationDate: string | undefined;
  let qualificationPlatform: string | undefined;
  let qualificationSoftware: string | undefined;
  let qualificationVersion: string | undefined;
  let roundTripSamples: string | undefined;
  for (let index = 0; index < rest.length; index += 1) {
    const option = rest[index];
    const value = rest[index + 1];
    if (!value) throw new Error("opzioni inventario DIZ non valide");
    if (option === "--output" && !output) output = value;
    else if (option === "--authorized-on" && !authorizationDate) authorizationDate = value;
    else if (option === "--qualification-on" && !qualificationDate) qualificationDate = value;
    else if (option === "--qualification-platform" && !qualificationPlatform) {
      qualificationPlatform = value;
    } else if (option === "--qualification-software" && !qualificationSoftware) {
      qualificationSoftware = value;
    } else if (option === "--qualification-version" && !qualificationVersion) {
      qualificationVersion = value;
    } else if (option === "--round-trip-samples" && !roundTripSamples) {
      roundTripSamples = value;
    } else {
      throw new Error("opzioni inventario DIZ non valide");
    }
    index += 1;
  }
  const qualificationValues = [
    qualificationDate,
    qualificationPlatform,
    qualificationSoftware,
    qualificationVersion,
    roundTripSamples,
  ];
  const hasQualification = qualificationValues.some(Boolean);
  if (hasQualification && qualificationValues.some((value) => !value)) {
    throw new Error("la qualificazione round-trip richiede tutte le relative opzioni");
  }
  const sampleIds = roundTripSamples?.split(",").filter(Boolean) ?? [];
  if (
    hasQualification &&
    (sampleIds.length === 0 ||
      new Set(sampleIds).size !== sampleIds.length ||
      sampleIds.some((sampleId) => !/^sample-\d{2}$/.test(sampleId)))
  ) {
    throw new Error("gli identificativi dei campioni round-trip non sono validi");
  }
  return {
    authorizationDate: assertIsoDate(authorizationDate, "la data esplicita di autorizzazione"),
    corpus: path.resolve(corpus),
    output: output ? path.resolve(output) : undefined,
    roundTripQualification: hasQualification
      ? {
          observedOn: assertIsoDate(qualificationDate, "la data di qualificazione"),
          platform: qualificationPlatform!,
          sampleIds,
          software: qualificationSoftware!,
          softwareVersion: qualificationVersion!,
        }
      : undefined,
  };
}

function compositeDigest(samples: readonly { sha256: string; bytes: number }[]): string {
  const canonical = samples.map((sample) => `${sample.sha256}:${sample.bytes}\n`).join("");
  return createHash("sha256").update(canonical).digest("hex");
}

async function writePrivateInventory(output: string, content: string): Promise<void> {
  const temporary = `${output}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, output);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const names = (await readdir(options.corpus))
    .filter((name) => name.toLowerCase().endsWith(".diz"))
    .sort((left, right) => left.localeCompare(right));
  if (names.length === 0) throw new Error("il corpus DIZ è vuoto");

  const samples = [];
  for (const [index, name] of names.entries()) {
    const parsed = parseDiz(await readFile(path.join(options.corpus, name)));
    const id = `sample-${String(index + 1).padStart(2, "0")}`;
    const officialRoundTrip = options.roundTripQualification?.sampleIds.includes(id) ?? false;
    samples.push({
      id,
      privateFileName: name,
      sha256: parsed.sha256,
      bytes: parsed.bytes,
      format: parsed.format,
      entries: parsed.entryCount,
      xmlBytes: parsed.xmlBytes,
      quadri: [...new Set(parsed.fields.map((field) => field.quadro))].sort(),
      modules: new Set(parsed.fields.map((field) => `${field.quadro}:${field.module}`)).size,
      fields: parsed.fields.length,
      attachments: parsed.attachments.length,
      attachmentBytes: parsed.attachments.reduce((sum, attachment) => sum + attachment.bytes, 0),
      declarationType: {
        status: "unqualified",
        reason: "richiede il mapping qualificato del frontespizio previsto da TG-COMPLIANCE",
      },
      sourceEnvironment: {
        status: "not-encoded-in-diz",
        platform: null,
        softwareVersion: null,
        reason: "piattaforma e versione di origine non sono codificate nel campione DIZ",
      },
      interoperabilityEvidence: officialRoundTrip
        ? {
            status: "official-round-trip",
            observedOn: options.roundTripQualification!.observedOn,
            platform: options.roundTripQualification!.platform,
            software: options.roundTripQualification!.software,
            softwareVersion: options.roundTripQualification!.softwareVersion,
          }
        : {
            status: "parser-only",
            observedOn: options.authorizationDate,
            tool: "Sequent DIZ parser prototype",
          },
    });
  }

  const sampleIds = new Set(samples.map((sample) => sample.id));
  const missingQualifiedSamples =
    options.roundTripQualification?.sampleIds.filter((sampleId) => !sampleIds.has(sampleId)) ?? [];
  if (missingQualifiedSamples.length > 0) {
    throw new Error("la qualificazione round-trip indica campioni assenti dal corpus");
  }

  const inventory = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    corpus: {
      samples: samples.length,
      compositeSha256: compositeDigest(samples),
    },
    authorization: {
      confirmedByOwner: true,
      confirmationDate: options.authorizationDate,
      legitimateStudioUse: true,
      internalInteroperabilityOnly: true,
      permittedOperations: ["read", "write", "preserve", "round-trip"],
      redistributionPermitted: false,
    },
    legalPreflight: {
      officialDistributionObserved: true,
      publicSUC13SpecificationsAvailable: true,
      thirdPartyGeneratedTelematicFilesAllowedAfterOfficialControl: true,
      publicDizSpecificationFound: false,
      decompilationUsed: false,
      inspectedMaterials: ["DIZ bytes", "JNLP metadata", "declarative converter configuration"],
    },
    provenance: "private corpus supplied by the owner for authorized internal interoperability",
    samples,
  };
  const serialized = JSON.stringify(inventory, null, 2) + "\n";
  if (options.output) {
    await writePrivateInventory(options.output, serialized);
    console.log(
      JSON.stringify({
        samples: samples.length,
        compositeSha256: inventory.corpus.compositeSha256,
      }),
    );
  } else {
    const sanitized = structuredClone(inventory);
    for (const sample of sanitized.samples) sample.privateFileName = "[private]";
    console.log(JSON.stringify(sanitized, null, 2));
  }
}

await main();
