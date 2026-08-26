#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

const output = (command, args) => execFileSync(command, args, { encoding: "utf8" }).trim();

export function validateManifest(manifest, { archiveName, archiveSha256, commit, imageId, tree }) {
  const failures = [];
  if (manifest.schema !== "sequent-release-artifact/v1") failures.push("schema non supportato");
  if (manifest.commit !== commit) failures.push("commit divergente");
  if (manifest.tree !== tree) failures.push("tree Git divergente");
  if (manifest.imageId !== imageId) failures.push("image ID divergente");
  if (manifest.archive.name !== archiveName) failures.push("nome archivio divergente");
  if (manifest.archive.sha256 !== archiveSha256) failures.push("SHA-256 archivio divergente");
  if (manifest.platform !== "linux/arm64") failures.push("piattaforma non ARM64");
  return failures;
}

async function create(args) {
  const archive = value(args, "--archive");
  const imageTag = value(args, "--image");
  const destination = value(args, "--output");
  execFileSync("git", ["diff", "--quiet"]);
  execFileSync("git", ["diff", "--cached", "--quiet"]);
  const manifest = {
    schema: "sequent-release-artifact/v1",
    commit: output("git", ["rev-parse", "HEAD"]),
    tree: output("git", ["rev-parse", "HEAD^{tree}"]),
    platform: "linux/arm64",
    imageTag,
    imageId: output("docker", ["image", "inspect", "--format", "{{.Id}}", imageTag]),
    archive: { name: basename(archive), sha256: await sha256(archive) },
  };
  await writeFile(destination, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(manifest, null, 2));
}

async function verify(args) {
  const archive = value(args, "--archive");
  const manifest = JSON.parse(await readFile(value(args, "--manifest"), "utf8"));
  const expected = {
    archiveName: basename(archive),
    archiveSha256: await sha256(archive),
    commit: output("git", ["rev-parse", "HEAD"]),
    tree: output("git", ["rev-parse", "HEAD^{tree}"]),
  };
  const preflightFailures = validateManifest(manifest, {
    ...expected,
    imageId: manifest.imageId,
  });
  if (preflightFailures.length) {
    throw new Error(`Artefatto release non valido: ${preflightFailures.join(", ")}`);
  }

  output("docker", ["load", "--input", archive]);
  const failures = validateManifest(manifest, {
    ...expected,
    imageId: output("docker", ["image", "inspect", "--format", "{{.Id}}", manifest.imageTag]),
  });
  if (failures.length) throw new Error(`Artefatto release non valido: ${failures.join(", ")}`);
  console.log(`Artefatto release verificato: ${manifest.imageId}`);
}

function value(args, flag) {
  const index = args.indexOf(flag);
  if (index < 0 || !args[index + 1]) throw new Error(`Argomento richiesto: ${flag}`);
  return args[index + 1];
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "create") return create(args);
  if (command === "verify") return verify(args);
  throw new Error("Uso: release-artifact.mjs create|verify ...");
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) await main();
