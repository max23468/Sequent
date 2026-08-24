#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { parseDiz } from "../../src/domain/diz/index.ts";

async function main() {
  const candidate = process.argv[2];
  if (!candidate) throw new Error("uso: npm run diz:inspect -- PERCORSO_DIZ");
  const resolved = path.resolve(candidate);
  const info = await stat(resolved);
  if (!info.isFile()) throw new Error("il campione DIZ non è un file");

  const parsed = parseDiz(await readFile(resolved));
  const quadri = new Set(parsed.fields.map((field) => field.quadro));
  const modules = new Set(parsed.fields.map((field) => `${field.quadro}:${field.module}`));

  console.log(
    JSON.stringify(
      {
        bytes: info.size,
        sha256: parsed.sha256,
        format: parsed.format,
        entries: parsed.entryCount,
        xmlBytes: parsed.xmlBytes,
        quadri: quadri.size,
        modules: modules.size,
        fields: parsed.fields.length,
        attachments: parsed.attachments.length,
        attachmentBytes: parsed.attachments.reduce((sum, attachment) => sum + attachment.bytes, 0),
        portablePaths: true,
      },
      null,
      2,
    ),
  );
}

await main();
