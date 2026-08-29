#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const RECEIPT_SCHEMA = "sequent-publication-receipt/v1";
export const RECEIPT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const output = (command, args) => execFileSync(command, args, { encoding: "utf8" }).trim();
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function receiptIdentity(commands) {
  const commonDir = output("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const head = output("git", ["rev-parse", "HEAD"]);
  return {
    path: join(commonDir, "sequent-publication-receipts", `${head}.json`),
    identity: {
      schema: RECEIPT_SCHEMA,
      head,
      tree: output("git", ["rev-parse", "HEAD^{tree}"]),
      lockfileSha256: sha256(readFileSync("package-lock.json")),
      node: process.version,
      npm: output("npm", ["--version"]),
      platform: process.platform,
      arch: process.arch,
      commands,
    },
  };
}

export function validateReceipt(receipt, identity, now = Date.now()) {
  const createdAt = Date.parse(receipt?.createdAt);
  if (
    !receipt ||
    !Number.isFinite(createdAt) ||
    createdAt > now ||
    now - createdAt > RECEIPT_MAX_AGE_MS
  )
    return false;
  return Object.entries(identity).every(
    ([key, value]) => JSON.stringify(receipt[key]) === JSON.stringify(value),
  );
}

export function readValidReceipt(commands) {
  const { path, identity } = receiptIdentity(commands);
  try {
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) return null;
    const receipt = JSON.parse(readFileSync(path, "utf8"));
    return validateReceipt(receipt, identity) ? receipt : null;
  } catch {
    return null;
  }
}

export function writeReceipt(commands) {
  const { path, identity } = receiptIdentity(commands);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try {
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.isSymbolicLink())
      throw new Error("Percorso ricevuta non regolare");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const receipt = { ...identity, createdAt: new Date().toISOString() };
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return receipt;
}
