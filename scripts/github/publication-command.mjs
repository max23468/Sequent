#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  assertPublicationCleanupPossible,
  finalizePublicationCleanup,
  publicationCleanupContext,
} from "./publication-cleanup.mjs";

const execute = process.argv.includes("--execute");
const context = publicationCleanupContext();
if (execute) assertPublicationCleanupPossible(context);

const publishScript = fileURLToPath(new URL("./publish.mjs", import.meta.url));
const publication = spawnSync(process.execPath, [publishScript, ...process.argv.slice(2)], {
  cwd: context.topLevel,
  env: { ...process.env, SEQUENT_PUBLICATION_WRAPPER: "1" },
  stdio: "inherit",
});
if (publication.error) throw publication.error;
if (publication.status !== 0) process.exit(publication.status ?? 1);

if (execute) {
  const cleanup = finalizePublicationCleanup(context);
  console.log(JSON.stringify({ chiusuraPubblicazione: cleanup }, null, 2));
}
