#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const markdownFiles = execFileSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "*.md"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean)
  .sort();

const satelliteExceptions = new Set(["CHANGELOG.md", "docs/MASTER_PLAN.md"]);
const sourceManifest = JSON.parse(
  readFileSync("src/domain/official-catalog/source-manifest.json", "utf8"),
);
const forbiddenSourceMetadata = [
  sourceManifest.bundleId,
  sourceManifest.compositeSha256,
  sourceManifest.xsdTreeCompositeSha256,
].filter(Boolean);
const violations = [];

for (const file of markdownFiles) {
  const content = readFileSync(file, "utf8");

  if (forbiddenSourceMetadata.some((value) => content.includes(value))) {
    violations.push(`${file}: replica identità o digest del bundle ufficiale`);
  }

  if (/\b(?:Node(?:\.js)?|TypeScript|Svelte)\s+\d+\b/u.test(content)) {
    violations.push(`${file}: replica una major tecnica definita nei manifest eseguibili`);
  }

  if (satelliteExceptions.has(file)) continue;

  const checks = [
    [/\bM\d+\b|\bmilestone\b/iu, "replica una milestone"],
    [/\b20\d{2}\b/u, "contiene una data invece di rimandare alla fonte canonica"],
    [/\bv?\d+\.\d+(?:\.\d+)?\b/iu, "replica una versione"],
    [/\bsezion(?:e|i)\s+\d/iu, "usa un riferimento numerico fragile a una sezione"],
  ];

  for (const [pattern, message] of checks) {
    if (pattern.test(content)) violations.push(`${file}: ${message}`);
  }
}

const masterPlan = readFileSync("docs/MASTER_PLAN.md", "utf8");
const milestoneStart = masterPlan.indexOf("# 56. Milestone di implementazione");
const milestoneEnd = masterPlan.indexOf("# 57. Risk register essenziale");

if (milestoneStart === -1 || milestoneEnd <= milestoneStart) {
  violations.push("docs/MASTER_PLAN.md: capitolo milestone non individuabile");
} else {
  const outsideMilestones = masterPlan.slice(0, milestoneStart) + masterPlan.slice(milestoneEnd);
  if (/\bM\d+\b/u.test(outsideMilestones)) {
    violations.push("docs/MASTER_PLAN.md: ID milestone duplicato fuori dal capitolo canonico");
  }
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
for (const [tool, version] of Object.entries(packageJson.engines ?? {})) {
  for (const file of markdownFiles) {
    if (readFileSync(file, "utf8").includes(String(version))) {
      violations.push(`${file}: replica la versione di ${tool} definita in package.json`);
    }
  }
}

if (violations.length > 0) {
  console.error(`Riferimenti documentali fragili:\n${violations.join("\n")}`);
  process.exit(1);
}

console.log(`Coerenza documentale verificata: ${markdownFiles.length} file Markdown`);
