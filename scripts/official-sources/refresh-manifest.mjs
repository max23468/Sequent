#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "../..");
const officialRoot = path.join(repoRoot, "private/official-sources");
const canonicalPath = path.join(repoRoot, "src/domain/official-catalog/source-manifest.json");
const privateManifestPath = path.join(officialRoot, "manifest.json");
const privateXsdManifestPath = path.join(officialRoot, "xsd-manifest.json");

function sha256(input) {
  return createHash("sha256").update(input).digest("hex");
}

function pageCount(filePath) {
  const output = execFileSync("pdfinfo", [filePath], { encoding: "utf8" });
  const match = /^Pages:\s+(\d+)$/mu.exec(output);
  if (!match) throw new Error(`Numero di pagine non leggibile: ${filePath}`);
  return Number(match[1]);
}

const manifest = JSON.parse(readFileSync(canonicalPath, "utf8"));
for (const source of manifest.sources) {
  const filePath = path.join(officialRoot, source.alias);
  const bytes = readFileSync(filePath);
  source.bytes = statSync(filePath).size;
  source.sha256 = sha256(bytes);
  source.pages = source.alias.endsWith(".pdf") ? pageCount(filePath) : null;
}

const compositeInput = [...manifest.sources]
  .sort((left, right) => left.id.localeCompare(right.id))
  .map((source) => `${source.id}:${source.sha256}\n`)
  .join("");
manifest.compositeSha256 = sha256(Buffer.from(compositeInput, "utf8"));

const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
writeFileSync(canonicalPath, serialized);
writeFileSync(privateManifestPath, serialized);
writeFileSync(privateXsdManifestPath, `${JSON.stringify(manifest.xsdArchive, null, 2)}\n`);

console.log(`Aggiornato ${manifest.bundleId}: ${manifest.sources.length} fonti`);
console.log(`Digest composito: ${manifest.compositeSha256}`);
