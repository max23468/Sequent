#!/usr/bin/env node
import { open, stat } from "node:fs/promises";
import path from "node:path";

async function main() {
  const candidate = process.argv[2];
  if (!candidate) throw new Error("uso: npm run diz:inspect -- PERCORSO_DIZ");
  const resolved = path.resolve(candidate);
  const info = await stat(resolved);
  if (!info.isFile()) throw new Error("il campione DIZ non è un file");

  const handle = await open(resolved, "r");
  const prefix = Buffer.alloc(Math.min(64, info.size));
  await handle.read(prefix, 0, prefix.length, 0);
  await handle.close();

  const signature = prefix.subarray(0, 8).toString("hex");
  const classification = prefix.subarray(0, 4).equals(Buffer.from("PK\u0003\u0004"))
    ? "zip"
    : prefix.subarray(0, 1).toString() === "<"
      ? "xml"
      : "unknown";

  console.log(
    JSON.stringify(
      { file: path.basename(resolved), bytes: info.size, signature, classification },
      null,
      2,
    ),
  );
}

await main();
