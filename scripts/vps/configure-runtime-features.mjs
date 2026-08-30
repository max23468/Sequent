#!/usr/bin/env node

import { constants } from "node:fs";
import { chmod, lstat, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";

const allowedKeys = [
  "SEQUENT_IMAGE",
  "SEQUENT_RUNTIME_UID",
  "SEQUENT_RUNTIME_GID",
  "SEQUENT_ORIGIN",
  "SEQUENT_CODEX_ENABLED",
  "SEQUENT_DIZ_ENABLED",
];
const requiredBaseKeys = allowedKeys.slice(0, 4);

function fail(message) {
  throw new Error(message);
}

function parseBoolean(value, label) {
  if (value !== "true" && value !== "false") fail(`${label} deve essere true o false`);
  return value;
}

function parseArguments(arguments_) {
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const option = arguments_[index];
    const value = arguments_[index + 1];
    if (!option || value === undefined || !["--codex", "--diz"].includes(option))
      fail("uso: configure-runtime-features.mjs --codex true|false --diz true|false");
    if (values.has(option)) fail(`opzione duplicata: ${option}`);
    values.set(option, parseBoolean(value, option));
  }
  if (values.size !== 2 || !values.has("--codex") || !values.has("--diz"))
    fail("specificare entrambe le flag --codex e --diz");
  return values;
}

function parseConfiguration(source) {
  const values = new Map();
  for (const line of source.split("\n")) {
    if (!line) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) fail("riga della configurazione runtime non valida");
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (!allowedKeys.includes(key)) fail(`chiave runtime non ammessa: ${key}`);
    if (values.has(key)) fail(`chiave runtime duplicata: ${key}`);
    values.set(key, value);
  }
  if (!requiredBaseKeys.every((key) => values.has(key)))
    fail("configurazione runtime di base incompleta");
  return values;
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2));
  const root = process.env.SEQUENT_ROOT ?? "/opt/sequent";
  const runtimeDirectory = join(root, "runtime");
  const runtimeEnvironment = join(runtimeDirectory, "runtime.env");
  const temporaryEnvironment = join(
    runtimeDirectory,
    `.runtime.env.next.${process.pid}.${Date.now()}`,
  );
  const metadata = await lstat(runtimeEnvironment);
  if (!metadata.isFile() || metadata.isSymbolicLink()) fail("configurazione runtime non regolare");
  if ((metadata.mode & 0o777) !== 0o600) fail("permessi della configurazione runtime non conformi");
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid())
    fail("la configurazione runtime non appartiene all’utente corrente");

  const values = parseConfiguration(await readFile(runtimeEnvironment, "utf8"));
  values.set("SEQUENT_CODEX_ENABLED", arguments_.get("--codex"));
  values.set("SEQUENT_DIZ_ENABLED", arguments_.get("--diz"));
  const output = `${allowedKeys.map((key) => `${key}=${values.get(key)}`).join("\n")}\n`;

  let temporaryFile;
  try {
    temporaryFile = await open(
      temporaryEnvironment,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    await temporaryFile.writeFile(output, "utf8");
    await temporaryFile.sync();
    await temporaryFile.close();
    temporaryFile = undefined;
    await chmod(temporaryEnvironment, 0o600);
    await rename(temporaryEnvironment, runtimeEnvironment);
  } catch (error) {
    await temporaryFile?.close().catch(() => {});
    await unlink(temporaryEnvironment).catch(() => {});
    throw error;
  }
  console.log("OK: feature flag runtime configurate; il servizio non è stato riavviato");
}

main().catch((error) => {
  console.error(`ERRORE: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
