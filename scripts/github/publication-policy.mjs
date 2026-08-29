#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const LEVELS = ["rapid", "ordinary", "sensitive", "release"];
const DIFF_FILTER = "ACDMRTUXB";

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

const PACKAGE_METADATA = /^(?:package|package-lock)\.json$/;

const ARM64 = [
  /^Dockerfile$/,
  /^requirements-ocr\.txt$/,
  /^deploy\//,
  /^scripts\/vps\//,
  PACKAGE_METADATA,
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
  /^private\/official-sources\//,
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
  /^requirements-ocr\.txt$/,
  /^src\/lib\/server\/(?:document-ingestion|launchers)\.ts$/,
  /^src\/routes\/documenti\//,
  /^tests\/(?:integration\/document-ingestion|unit\/launchers)\.test\.ts$/,
  /^scripts\/benchmark\//,
];
const GOVERNANCE = [/^\.github\/workflows\//, /^scripts\/github\//, PACKAGE_METADATA];

const TEST_ONLY = [/^tests\//, /(?:^|\.)test\.[cm]?[jt]sx?$/, /^playwright\.config\.ts$/];

const RUNTIME = [
  /^Dockerfile$/,
  /^requirements-ocr\.txt$/,
  /^deploy\//,
  /^package(?:-lock)?\.json$/,
  /^src\//,
  /^static\//,
  /^scripts\/vps\//,
  /^(?:svelte\.config\.js|tsconfig\.json|vite\.config\.ts)$/,
];

const KNOWN_NON_RUNTIME = [
  ...RAPID_ONLY,
  ...GOVERNANCE,
  ...TEST_ONLY,
  /^\.github\//,
  /^scripts\/(?!vps\/)/,
  /^private\/official-sources\//,
  /^tests\//,
  /^(?:CONTRIBUTING\.md|\.dockerignore|\.gitignore|svelte-doctor\.config\.json)$/,
];

export function classifyChangedFiles(files, { release = false, packageMetadataOnly = false } = {}) {
  const normalized = [
    ...new Set(files.filter(Boolean).map((file) => file.replace(/^\.\//, ""))),
  ].sort();
  const materialFiles = packageMetadataOnly
    ? normalized.filter((file) => !PACKAGE_METADATA.test(file))
    : normalized;
  const capabilities = {
    arm64: matchesAny(materialFiles, ARM64),
    browser: matchesAny(materialFiles, BROWSER),
    compliance: matchesAny(materialFiles, COMPLIANCE),
    diz: matchesAny(materialFiles, DIZ),
    documents: matchesAny(materialFiles, DOCUMENTS),
    persistence: matchesAny(materialFiles, PERSISTENCE),
    security: matchesAny(materialFiles, SECURITY),
  };
  const unknown = normalized.filter(
    (file) => !matches(file, RUNTIME) && !matches(file, KNOWN_NON_RUNTIME),
  );
  const rapid = normalized.length > 0 && normalized.every((file) => matches(file, RAPID_ONLY));
  const sensitive =
    matchesAny(materialFiles, GOVERNANCE) ||
    Object.values(capabilities).some(Boolean) ||
    normalized.length === 0 ||
    unknown.length > 0;
  const runtime =
    normalized.length === 0 || matchesAny(materialFiles, RUNTIME) || unknown.length > 0;
  const level = release ? "release" : rapid ? "rapid" : sensitive ? "sensitive" : "ordinary";

  return {
    level,
    files: normalized,
    packageMetadataOnly,
    unknown,
    runtime,
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

function stripVersionMetadata(file, value) {
  const normalized = structuredClone(value);
  if (file === "package.json") delete normalized.version;
  if (file === "package-lock.json") {
    delete normalized.version;
    if (normalized.packages?.[""]) delete normalized.packages[""].version;
  }
  return normalized;
}

export function packageChangesAreVersionOnly(base, head = "HEAD", readBlob = gitBlob) {
  for (const file of ["package.json", "package-lock.json"]) {
    let before;
    let after;
    try {
      before = JSON.parse(readBlob(base, file));
      after = JSON.parse(readBlob(head, file));
    } catch {
      return false;
    }
    if (
      JSON.stringify(stripVersionMetadata(file, before)) !==
      JSON.stringify(stripVersionMetadata(file, after))
    ) {
      return false;
    }
  }
  return true;
}

function gitBlob(revision, file) {
  return execFileSync("git", ["show", `${revision}:${file}`], { encoding: "utf8" });
}

export function classifyRevisionRange(base, head = "HEAD", { release = false } = {}) {
  const files = changedFiles(base, head);
  const packageChanged = files.some((file) => PACKAGE_METADATA.test(file));
  return classifyChangedFiles(files, {
    release,
    packageMetadataOnly: packageChanged && packageChangesAreVersionOnly(base, head),
  });
}

function matchesAny(files, patterns) {
  return files.some((file) => matches(file, patterns));
}

export function parseChangedPaths(nameStatus) {
  const fields = nameStatus.split("\0");
  const files = [];
  for (let index = 0; index < fields.length && fields[index];) {
    const status = fields[index++];
    const source = fields[index++];
    if (!source) throw new Error(`Diff Git non interpretabile per lo stato ${status}`);
    files.push(source);
    if (/^[CR]/.test(status)) {
      const destination = fields[index++];
      if (!destination) throw new Error(`Diff Git senza destinazione per lo stato ${status}`);
      files.push(destination);
    }
  }
  return [...new Set(files)];
}

export function changedFiles(base, head = "HEAD") {
  const nameStatus = execFileSync(
    "git",
    [
      "diff",
      "--name-status",
      "--find-renames",
      "-z",
      `--diff-filter=${DIFF_FILTER}`,
      `${base}...${head}`,
    ],
    {
      encoding: "utf8",
    },
  );
  return parseChangedPaths(nameStatus);
}

export function githubOutputs(classification) {
  return {
    level: classification.level,
    runtime: String(classification.runtime),
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
  const classification = classifyRevisionRange(base, head, { release: args.includes("--release") });
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

export { DIFF_FILTER, LEVELS };
