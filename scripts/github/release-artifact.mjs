#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const output = (command, args) => execFileSync(command, args, { encoding: "utf8" }).trim();
const DIGEST_REFERENCE = /^ghcr\.io\/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$/;

export function validateManifest(manifest, { commit, tree, reference = manifest.reference }) {
  const failures = [];
  if (manifest.schema !== "sequent-release-image/v2") failures.push("schema non supportato");
  if (manifest.commit !== commit) failures.push("commit divergente");
  if (manifest.tree !== tree) failures.push("tree Git divergente");
  if (manifest.reference !== reference) failures.push("riferimento immagine divergente");
  if (!DIGEST_REFERENCE.test(manifest.reference ?? "")) failures.push("digest GHCR non valido");
  if (manifest.digest !== manifest.reference?.split("@")[1]) failures.push("digest divergente");
  if (manifest.platform !== "linux/arm64") failures.push("piattaforma non ARM64");
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version ?? "")) failures.push("versione non valida");
  return failures;
}

async function create(args) {
  const reference = value(args, "--reference");
  const destination = value(args, "--output");
  execFileSync("git", ["diff", "--quiet"]);
  execFileSync("git", ["diff", "--cached", "--quiet"]);
  const commit = output("git", ["rev-parse", "HEAD"]);
  const tree = output("git", ["rev-parse", "HEAD^{tree}"]);
  const manifest = {
    schema: "sequent-release-image/v2",
    commit,
    tree,
    platform: "linux/arm64",
    version: JSON.parse(await readFile("package.json", "utf8")).version,
    reference,
    digest: reference.split("@")[1],
  };
  const failures = validateManifest(manifest, { commit, tree, reference });
  if (failures.length) throw new Error(`Manifest release non valido: ${failures.join(", ")}`);
  await writeFile(destination, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(manifest, null, 2));
}

async function verify(args) {
  const manifest = JSON.parse(await readFile(value(args, "--manifest"), "utf8"));
  const expected = {
    commit: value(args, "--commit"),
    tree: value(args, "--tree"),
    reference: argument(args, "--reference") ?? manifest.reference,
  };
  const failures = validateManifest(manifest, expected);
  if (failures.length) throw new Error(`Manifest release non valido: ${failures.join(", ")}`);
  if (args.includes("--pull")) {
    output("docker", ["pull", "--platform", "linux/arm64", manifest.reference]);
    const architecture = output("docker", [
      "image",
      "inspect",
      "--format",
      "{{.Architecture}}",
      manifest.reference,
    ]);
    const revision = output("docker", [
      "image",
      "inspect",
      "--format",
      '{{index .Config.Labels "org.opencontainers.image.revision"}}',
      manifest.reference,
    ]);
    if (architecture !== "arm64" || revision !== manifest.commit)
      throw new Error("Readback immagine GHCR divergente");
  }
  console.log(`Manifest release verificato: ${manifest.reference}`);
}

function argument(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function value(args, flag) {
  const found = argument(args, flag);
  if (!found) throw new Error(`Argomento richiesto: ${flag}`);
  return found;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "create") return create(args);
  if (command === "verify") return verify(args);
  throw new Error("Uso: release-artifact.mjs create|verify ...");
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) await main();
