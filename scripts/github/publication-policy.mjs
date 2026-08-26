#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const LEVELS = ["rapid", "ordinary", "sensitive", "release"];

const matches = (file, patterns) => patterns.some((pattern) => pattern.test(file));

const RAPID_ONLY = [
  /^(?:AGENTS|CHANGELOG|README|SECURITY)\.md$/,
  /^docs\//,
  /^\.github\/PULL_REQUEST_TEMPLATE\.md$/,
];

const BROWSER = [
  /\.svelte$/,
  /^src\/(?:routes|styles)\//,
  /^src\/lib\/client\//,
  /^src\/lib\/components\//,
  /^tests\/e2e\//,
  /^(?:playwright\.config\.ts|svelte\.config\.js|vite\.config\.ts)$/,
];

const ARM64 = [
  /^Dockerfile$/,
  /^deploy\//,
  /^scripts\/vps\//,
  /^(?:package|package-lock)\.json$/,
  /^src\/lib\/server\/(?:document-ingestion|launchers)\.ts$/,
  /^tests\/(?:integration\/document-ingestion|unit\/launchers|vps\/)/,
];

const PERSISTENCE = [
  /^src\/lib\/server\/(?:backup|blob-store|database|job-runner|jobs|practices)\.ts$/,
  /^scripts\/admin\//,
  /^tests\/(?:integration\/(?:backup|blob-store|job-restart)|unit\/(?:jobs|practices))\.test\.ts$/,
];

const DIZ = [
  /^src\/domain\/diz\//,
  /^scripts\/diz\//,
  /^tests\/diz\//,
  /^docs\/(?:contracts\/diz|diz-lab\/)/,
];
const COMPLIANCE = [
  /^src\/domain\/official-catalog\//,
  /^scripts\/official-sources\//,
  /^tests\/official-sources\//,
  /^docs\/contracts\/official-compliance\.md$/,
];
const SECURITY = [
  /^src\/(?:hooks\.server\.ts|lib\/server\/auth\.ts)$/,
  /^src\/routes\/(?:login|logout|setup)\//,
  /^tests\/unit\/auth\.test\.ts$/,
  /^SECURITY\.md$/,
];
const DOCUMENTS = [
  /^src\/lib\/server\/(?:document-ingestion|launchers)\.ts$/,
  /^src\/routes\/documenti\//,
  /^tests\/(?:integration\/document-ingestion|unit\/launchers)\.test\.ts$/,
  /^scripts\/benchmark\//,
];
const GOVERNANCE = [
  /^\.github\/workflows\//,
  /^scripts\/github\//,
  /^scripts\/codex-review-gate(?:\.test)?\.mjs$/,
  /^package(?:-lock)?\.json$/,
];

export function classifyChangedFiles(files, { release = false } = {}) {
  const normalized = [
    ...new Set(files.filter(Boolean).map((file) => file.replace(/^\.\//, ""))),
  ].sort();
  const capabilities = {
    arm64: matchesAny(normalized, ARM64),
    browser: matchesAny(normalized, BROWSER),
    compliance: matchesAny(normalized, COMPLIANCE),
    diz: matchesAny(normalized, DIZ),
    documents: matchesAny(normalized, DOCUMENTS),
    persistence: matchesAny(normalized, PERSISTENCE),
    security: matchesAny(normalized, SECURITY),
  };
  const rapid = normalized.length > 0 && normalized.every((file) => matches(file, RAPID_ONLY));
  const sensitive =
    matchesAny(normalized, GOVERNANCE) ||
    Object.values(capabilities).some(Boolean) ||
    normalized.length === 0;
  const level = release ? "release" : rapid ? "rapid" : sensitive ? "sensitive" : "ordinary";

  return {
    level,
    files: normalized,
    ...capabilities,
    runArm64: release || capabilities.arm64 || capabilities.documents,
    runBrowser:
      release ||
      capabilities.browser ||
      capabilities.documents ||
      capabilities.persistence ||
      capabilities.security,
    runFull: release,
  };
}

function matchesAny(files, patterns) {
  return files.some((file) => matches(file, patterns));
}

export function changedFiles(base, head = "HEAD") {
  return execFileSync(
    "git",
    ["diff", "--name-only", "--diff-filter=ACMRTUXB", `${base}...${head}`],
    {
      encoding: "utf8",
    },
  )
    .split("\n")
    .filter(Boolean);
}

export function githubOutputs(classification) {
  return {
    level: classification.level,
    arm64: String(classification.runArm64),
    browser: String(classification.runBrowser),
    compliance: String(classification.compliance),
    diz: String(classification.diz),
    documents: String(classification.documents),
    persistence: String(classification.persistence),
    security: String(classification.security),
  };
}

function main() {
  const args = process.argv.slice(2);
  const baseIndex = args.indexOf("--base");
  const headIndex = args.indexOf("--head");
  const base = baseIndex >= 0 ? args[baseIndex + 1] : "origin/main";
  const head = headIndex >= 0 ? args[headIndex + 1] : "HEAD";
  const classification = classifyChangedFiles(changedFiles(base, head), {
    release: args.includes("--release"),
  });
  const outputs = githubOutputs(classification);

  if (process.env.GITHUB_OUTPUT) {
    const lines = Object.entries(outputs)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");
    process.stdout.write(`${JSON.stringify(classification, null, 2)}\n`);
    appendFileSync(process.env.GITHUB_OUTPUT, `${lines}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(classification, null, 2)}\n`);
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) main();

export { LEVELS };
