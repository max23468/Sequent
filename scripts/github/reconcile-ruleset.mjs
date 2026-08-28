#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const REQUIRED_CHECKS = [
  "Foundation",
  "Dependency review",
  "Analyze (javascript-typescript)",
  "PR gate",
];

export function reconciledRuleset(ruleset) {
  const rules = ruleset.rules.map((rule) =>
    rule.type === "required_status_checks"
      ? {
          ...rule,
          parameters: {
            ...rule.parameters,
            required_status_checks: REQUIRED_CHECKS.map((context) => ({ context })),
            strict_required_status_checks_policy: true,
          },
        }
      : rule,
  );
  if (!rules.some((rule) => rule.type === "required_status_checks")) {
    throw new Error("La ruleset non contiene required_status_checks");
  }
  return {
    name: ruleset.name,
    target: ruleset.target,
    enforcement: ruleset.enforcement,
    bypass_actors: ruleset.bypass_actors ?? [],
    conditions: ruleset.conditions,
    rules,
  };
}

function ghJson(args, options = {}) {
  return JSON.parse(execFileSync("gh", args, { encoding: "utf8", ...options }));
}

function main() {
  const apply = process.argv.includes("--apply");
  const repository = ghJson(["repo", "view", "--json", "nameWithOwner"]).nameWithOwner;
  const summaries = ghJson(["api", `repos/${repository}/rulesets`]);
  const summary = summaries.find((candidate) => candidate.name === "main protection");
  if (!summary) throw new Error("Ruleset main protection non trovata");
  const current = ghJson(["api", `repos/${repository}/rulesets/${summary.id}`]);
  const desired = reconciledRuleset(current);
  const currentChecks = current.rules
    .find((rule) => rule.type === "required_status_checks")
    ?.parameters.required_status_checks.map(({ context }) => context);

  console.log(JSON.stringify({ current: currentChecks, desired: REQUIRED_CHECKS }, null, 2));
  if (!apply) {
    console.log("Dry-run: usa --apply soltanto durante una pubblicazione autorizzata.");
    return;
  }

  const result = spawnSync(
    "gh",
    ["api", "--method", "PUT", `repos/${repository}/rulesets/${summary.id}`, "--input", "-"],
    { encoding: "utf8", input: JSON.stringify(desired), stdio: ["pipe", "pipe", "inherit"] },
  );
  if (result.status !== 0) throw new Error("Aggiornamento della ruleset non riuscito");
  const updated = JSON.parse(result.stdout);
  const readback = updated.rules
    .find((rule) => rule.type === "required_status_checks")
    ?.parameters.required_status_checks.map(({ context }) => context);
  if (JSON.stringify(readback) !== JSON.stringify(REQUIRED_CHECKS)) {
    throw new Error("Rilettura della ruleset divergente");
  }
  console.log("Ruleset main protection riconciliata e riletta.");
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) main();
