#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { classifyRevisionRange } from "./publication-policy.mjs";
import { localGateCommands } from "./publish.mjs";
import { writeReceipt } from "./publication-receipt.mjs";

if (
  spawnSync("git", ["diff", "--quiet"]).status !== 0 ||
  spawnSync("git", ["diff", "--cached", "--quiet"]).status !== 0
) {
  throw new Error("verify:publication richiede un HEAD già committato e una working tree pulita");
}
const classification = classifyRevisionRange("origin/main", "HEAD");
const commands = localGateCommands(classification);
for (const [command, args] of commands) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} non riuscito`);
}
writeReceipt(commands.map(([command, args]) => [command, ...args]));
